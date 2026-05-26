import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";

export interface StartHttpOptions {
  server: McpServer;
  logger: Logger;
  host: string;
  port: number;
  authToken: string;
  packageVersion: string;
}

/**
 * Attach the MCP server to a streamable HTTP transport behind Bearer auth
 * and an Express app.
 *
 * Sessions are tracked via the SDK's built-in `sessionIdGenerator` (one
 * transport per session). A small in-memory map keeps transports alive for
 * the lifetime of a session and tears them down on `DELETE /mcp`. For
 * single-process deployments this is enough; for multi-replica setups a
 * sticky-session ingress is required (documented in README).
 */
export async function startHttpTransport(opts: StartHttpOptions): Promise<void> {
  const { server, logger, host, port, authToken, packageVersion } = opts;
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, version: packageVersion });
  });

  const auth = bearerAuthMiddleware(authToken, logger);

  app.post("/mcp", auth, async (req, res) => {
    const sessionHeader = req.header("mcp-session-id");
    let transport: StreamableHTTPServerTransport;
    if (sessionHeader && transports.has(sessionHeader)) {
      transport = transports.get(sessionHeader)!;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
          logger.debug("transport.http.session_open", { session_id: sid });
        },
        onsessionclosed: (sid) => {
          transports.delete(sid);
          logger.debug("transport.http.session_close", { session_id: sid });
        },
      });
      await server.connect(transport);
    }
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("transport.http.error", { detail: (err as Error).message });
      if (!res.headersSent) res.status(500).json({ error: "internal transport error" });
    }
  });

  app.get("/mcp", auth, async (req, res) => {
    const sessionHeader = req.header("mcp-session-id");
    if (!sessionHeader || !transports.has(sessionHeader)) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const transport = transports.get(sessionHeader)!;
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      logger.error("transport.http.error", { detail: (err as Error).message });
      if (!res.headersSent) res.status(500).json({ error: "internal transport error" });
    }
  });

  app.delete("/mcp", auth, async (req, res) => {
    const sessionHeader = req.header("mcp-session-id");
    if (!sessionHeader || !transports.has(sessionHeader)) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const transport = transports.get(sessionHeader)!;
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      logger.error("transport.http.error", { detail: (err as Error).message });
      if (!res.headersSent) res.status(500).json({ error: "internal transport error" });
    }
  });

  await new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      logger.info("transport.http.listening", { host, port });
      resolve();
    });
  });
}

function bearerAuthMiddleware(authToken: string, logger: Logger) {
  const expected = `Bearer ${authToken}`;
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization");
    if (header !== expected) {
      logger.warn("transport.http.auth_failed", {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
