import { z } from "zod";

import type { Catalogue } from "../catalogue/types.js";
import type { Logger } from "../logger.js";
import type { ProvenanceContext } from "../provenance.js";
import type { SessionStore } from "../session/store.js";
import { ToolError, type ToolErrorPayload } from "../errors.js";

export interface ToolContext {
  catalogue: Catalogue;
  sessionStore: SessionStore;
  provenance: ProvenanceContext;
  logger: Logger;
}

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  provenance: {
    data_commit: string;
    source: string;
    help_source?: string;
  };
  warnings: string[];
}

export interface ErrorEnvelope {
  ok: false;
  error: ToolErrorPayload;
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface ToolHandlerResult<T> {
  data: T;
  source: string;
  helpSource?: string;
  warnings?: string[];
}

export type ToolHandler<I, O> = (input: I, ctx: ToolContext) => Promise<ToolHandlerResult<O>>;

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  handler: ToolHandler<I, O>;
}

/**
 * Tools throw `ToolError` for known failure modes; anything else is a bug and
 * is reported as `INTERNAL_ERROR` with a generic message (no stack leak to
 * the client).
 */
export async function runTool<I, O>(
  def: ToolDefinition<I, O>,
  input: unknown,
  ctx: ToolContext
): Promise<Envelope<O>> {
  let parsedInput: I;
  try {
    parsedInput = def.inputSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: `Invalid arguments for tool '${def.name}'.`,
          field_errors: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      };
    }
    throw err;
  }

  try {
    const result = await def.handler(parsedInput, ctx);
    const validated = def.outputSchema.parse(result.data);
    const envelope: SuccessEnvelope<O> = {
      ok: true,
      data: validated,
      provenance: {
        data_commit: ctx.provenance.dataCommit,
        source: result.source,
      },
      warnings: result.warnings ?? [],
    };
    if (result.helpSource !== undefined) envelope.provenance.help_source = result.helpSource;
    return envelope;
  } catch (err) {
    if (err instanceof ToolError) {
      return { ok: false, error: err.toPayload() };
    }
    ctx.logger.error("tool.uncaught_error", {
      tool: def.name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `An internal error occurred while executing '${def.name}'.`,
      },
    };
  }
}
