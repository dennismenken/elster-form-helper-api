/**
 * Typed error codes used in tool error envelopes. Stable strings — clients
 * may switch on `code` to handle errors programmatically. Update with care.
 */

export const ERROR_CODES = {
  // Catalogue lookups
  TAX_TYPE_NOT_FOUND: "TAX_TYPE_NOT_FOUND",
  YEAR_NOT_FOUND: "YEAR_NOT_FOUND",
  FORM_NOT_FOUND: "FORM_NOT_FOUND",
  LINE_NOT_FOUND: "LINE_NOT_FOUND",
  PAGE_NOT_FOUND: "PAGE_NOT_FOUND",
  HELP_NOT_FOUND: "HELP_NOT_FOUND",

  // Validation
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_VALUE: "INVALID_VALUE",

  // Sessions
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PROFILE_FIELD_UNKNOWN: "PROFILE_FIELD_UNKNOWN",
  PROFILE_FIELD_INVALID: "PROFILE_FIELD_INVALID",

  // Generic
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DEGRADED_DATA: "DEGRADED_DATA",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ToolErrorPayload {
  code: ErrorCode;
  message: string;
  hint?: string;
  suggestions?: string[];
  /** Optional per-field detail from Zod validation. */
  field_errors?: { path: string; message: string }[];
}

export class ToolError extends Error {
  public readonly code: ErrorCode;
  public readonly hint?: string;
  public readonly suggestions?: string[];
  public readonly fieldErrors?: { path: string; message: string }[];

  constructor(payload: ToolErrorPayload) {
    super(payload.message);
    this.name = "ToolError";
    this.code = payload.code;
    if (payload.hint !== undefined) this.hint = payload.hint;
    if (payload.suggestions !== undefined) this.suggestions = payload.suggestions;
    if (payload.field_errors !== undefined) this.fieldErrors = payload.field_errors;
  }

  toPayload(): ToolErrorPayload {
    const out: ToolErrorPayload = { code: this.code, message: this.message };
    if (this.hint !== undefined) out.hint = this.hint;
    if (this.suggestions !== undefined) out.suggestions = this.suggestions;
    if (this.fieldErrors !== undefined) out.field_errors = this.fieldErrors;
    return out;
  }
}
