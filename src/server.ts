import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Catalogue } from "./catalogue/types.js";
import { ALL_TOOLS } from "./tools/registry.js";
import { runTool, type ToolContext } from "./tools/envelope.js";
import type { SessionStore } from "./session/store.js";
import { SERVER_INSTRUCTIONS } from "./instructions_header.js";
import { buildProvenanceContext } from "./provenance.js";
import type { Logger } from "./logger.js";

export interface BuildServerOptions {
  catalogue: Catalogue;
  sessionStore: SessionStore;
  logger: Logger;
  packageName: string;
  packageVersion: string;
  dataCommitOverride: string | null;
}

/**
 * Wire up a fully-configured MCP server. The returned `McpServer` is
 * transport-agnostic; attach it via `connect(transport)` to either stdio or
 * the streamable HTTP transport.
 */
export function buildMcpServer(opts: BuildServerOptions): McpServer {
  const provenance = buildProvenanceContext({
    dataCommitFromTriggerIndex: opts.catalogue.dataCommit,
    dataCommitOverride: opts.dataCommitOverride,
    packageVersion: opts.packageVersion,
  });

  const toolContext: ToolContext = {
    catalogue: opts.catalogue,
    sessionStore: opts.sessionStore,
    provenance,
    logger: opts.logger,
  };

  const server = new McpServer(
    { name: opts.packageName, version: opts.packageVersion },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} } }
  );

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: zodToInputShape(tool.inputSchema),
      },
      async (args) => {
        const envelope = await runTool(tool, args, toolContext);
        const text = JSON.stringify(envelope, null, 2);
        return {
          content: [{ type: "text", text }],
          structuredContent: envelope as unknown as Record<string, unknown>,
          isError: envelope.ok === false,
        };
      }
    );
  }

  return server;
}

/**
 * The SDK's `registerTool` expects `inputSchema` to be a ZodRawShape (an
 * object whose values are Zod schemas), not a full ZodObject. Our tool
 * definitions wrap inputs in `z.object({...}).strict()`; this helper peels
 * the shape back out so it lines up with the SDK contract.
 *
 * Tools that take no input use an empty shape, which the SDK accepts as a
 * tool with no arguments.
 */
import type { z } from "zod";
function zodToInputShape(schema: z.ZodType): Record<string, z.ZodTypeAny> {
  // ZodObject has a `.shape` accessor at runtime; everything else is a tool
  // that takes a non-object argument (none of ours do, but we fall back to
  // an empty shape rather than crashing).
  // The `any` cast is necessary because Zod's public types don't expose the
  // discriminator.
  const maybeObject = schema as unknown as {
    _def?: { typeName?: string };
    shape?: Record<string, z.ZodTypeAny>;
  };
  if (maybeObject._def?.typeName === "ZodObject" && maybeObject.shape) return maybeObject.shape;
  return {};
}
