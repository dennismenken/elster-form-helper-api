import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";

export interface StartStdioOptions {
  server: McpServer;
  logger: Logger;
}

/**
 * Attach the MCP server to a stdio transport. Returns once the transport
 * disconnects (process is then expected to exit).
 *
 * The MCP protocol uses stdout for JSON-RPC frames; the logger already writes
 * to stderr (see `logger.ts`), so the two channels do not interfere.
 */
export async function startStdioTransport(opts: StartStdioOptions): Promise<void> {
  const { server, logger } = opts;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("transport.stdio.ready", {});
  await new Promise<void>((resolve) => {
    transport.onclose = (): void => {
      logger.info("transport.stdio.closed", {});
      resolve();
    };
  });
}
