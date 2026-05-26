import type { Line, ValueType } from "../catalogue/types.js";

export interface ValidationOk {
  valid: true;
  normalized_value: unknown;
}

export interface ValidationError {
  valid: false;
  error: string;
  expected_format?: string;
}

export type ValidationResult = ValidationOk | ValidationError;

/**
 * Validate a user-provided value against a line's `value_type`. Returns a
 * tagged union so callers can branch without try/catch. The normalizer is
 * conservative — German strings flow through untouched; only structural
 * fields (dates, daterange) are reshaped.
 */
export function validateValue(line: Line, raw: unknown): ValidationResult {
  switch (line.value_type) {
    case "text":
      return validateText(raw);
    case "checkbox":
      return validateCheckbox(raw);
    case "select":
      return validateChoice(raw, line.allowed_values, "select");
    case "radio":
      return validateChoice(raw, line.allowed_values, "radio");
    case "date":
      return validateDate(raw);
    case "daterange":
      return validateDateRange(raw);
    case "note":
      return {
        valid: false,
        error: "Notes are informational; this line is not enterable.",
      };
    case "repeater":
      return {
        valid: false,
        error: "Repeater placeholders are not enterable; set the child fields instead.",
      };
    default:
      // exhaustiveness fallback — TypeScript prevents reaching here
      return assertNever(line.value_type);
  }
}

function validateText(raw: unknown): ValidationResult {
  if (typeof raw !== "string") {
    return {
      valid: false,
      error: "Expected a string.",
    };
  }
  return { valid: true, normalized_value: raw };
}

function validateCheckbox(raw: unknown): ValidationResult {
  if (typeof raw === "boolean") return { valid: true, normalized_value: raw };
  if (raw === "true") return { valid: true, normalized_value: true };
  if (raw === "false") return { valid: true, normalized_value: false };
  return {
    valid: false,
    error: "Expected a boolean.",
    expected_format: "true | false",
  };
}

function validateChoice(
  raw: unknown,
  allowed: readonly string[],
  kind: "select" | "radio"
): ValidationResult {
  if (typeof raw !== "string") {
    return {
      valid: false,
      error: `Expected a string from the closed allowed_values list (${kind}).`,
      expected_format: allowed.join(" | "),
    };
  }
  if (!allowed.includes(raw)) {
    return {
      valid: false,
      error: `Value '${raw}' is not in the allowed_values list for this ${kind} line.`,
      expected_format: allowed.join(" | "),
    };
  }
  return { valid: true, normalized_value: raw };
}

const GERMAN_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

function validateDate(raw: unknown): ValidationResult {
  if (typeof raw !== "string") {
    return {
      valid: false,
      error: "Expected a date string in DD.MM.YYYY format.",
      expected_format: "DD.MM.YYYY",
    };
  }
  const m = GERMAN_DATE_RE.exec(raw);
  if (!m) {
    return {
      valid: false,
      error: `Date '${raw}' does not match DD.MM.YYYY.`,
      expected_format: "DD.MM.YYYY",
    };
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!isCalendarValid(year, month, day)) {
    return {
      valid: false,
      error: `Date '${raw}' is not a valid calendar date.`,
      expected_format: "DD.MM.YYYY",
    };
  }
  return { valid: true, normalized_value: raw };
}

function validateDateRange(raw: unknown): ValidationResult {
  // First, normalize the input: some MCP clients (notably Claude Desktop in
  // certain versions) stringify an object argument when the tool's input
  // schema declares the field as `unknown`. If `raw` is a string that parses
  // as a JSON object with from/to keys, recover it transparently — the
  // caller's intent is clear and rejecting it would be user-hostile.
  const recovered = tryRecoverObjectFromJsonString(raw);
  const value = recovered ?? raw;

  if (typeof value === "object" && value !== null) {
    const obj = value as { from?: unknown; to?: unknown };
    if (typeof obj.from !== "string" || typeof obj.to !== "string") {
      return {
        valid: false,
        error: "Expected { from: string, to: string } in DD.MM.YYYY format.",
        expected_format: "{ from: 'DD.MM.YYYY', to: 'DD.MM.YYYY' }",
      };
    }
    return validateDateRangePair(obj.from, obj.to);
  }

  if (typeof value === "string") {
    // Accept "DD.MM.YYYY - DD.MM.YYYY" notation as a convenience.
    const parts = value.split(/\s*[-–]\s*/);
    if (parts.length !== 2) {
      return {
        valid: false,
        error: "Expected a daterange in the form 'DD.MM.YYYY - DD.MM.YYYY' or { from, to }.",
        expected_format: "DD.MM.YYYY - DD.MM.YYYY",
      };
    }
    return validateDateRangePair(parts[0]!, parts[1]!);
  }

  return {
    valid: false,
    error: "Expected a daterange string or object with from/to fields.",
    expected_format: "{ from: 'DD.MM.YYYY', to: 'DD.MM.YYYY' }",
  };
}

/**
 * If the input is a string that looks like a JSON-encoded object, attempt to
 * parse it. Returns the parsed object on success, null otherwise. This is
 * defensive plumbing for MCP clients that stringify structured tool arguments;
 * the regular string path is unaffected.
 */
function tryRecoverObjectFromJsonString(raw: unknown): object | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function validateDateRangePair(fromStr: string, toStr: string): ValidationResult {
  const from = validateDate(fromStr);
  if (!from.valid) return { ...from, error: `from: ${from.error}` };
  const to = validateDate(toStr);
  if (!to.valid) return { ...to, error: `to: ${to.error}` };
  const fromOrd = ordinalize(fromStr);
  const toOrd = ordinalize(toStr);
  if (toOrd < fromOrd) {
    return {
      valid: false,
      error: "Daterange end ('to') is earlier than start ('from').",
      expected_format: "from <= to",
    };
  }
  return { valid: true, normalized_value: { from: fromStr, to: toStr } };
}

function ordinalize(germanDate: string): number {
  // Convert DD.MM.YYYY to YYYYMMDD integer for ordering. Safe because dates
  // are pre-validated for calendar correctness before this is called.
  const m = GERMAN_DATE_RE.exec(germanDate);
  if (!m) return 0;
  const dd = m[1] ?? "00";
  const mm = m[2] ?? "00";
  const yyyy = m[3] ?? "0000";
  return Number(`${yyyy}${mm}${dd}`);
}

function isCalendarValid(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const monthLength = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLength[month - 1]!;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function assertNever(x: ValueType): never {
  throw new Error(`unhandled value_type: ${x}`);
}
