/**
 * Public domain model for the in-memory catalogue. The loader translates the
 * raw upstream JSON shapes (rows/values/context_label/etc.) into these
 * normalized types at the I/O boundary; nothing downstream of `loader.ts`
 * should ever see the raw shape.
 */

export type TaxType = "kst" | "gewst" | "ust";
export const TAX_TYPES: readonly TaxType[] = ["kst", "gewst", "ust"];

export function isTaxType(input: unknown): input is TaxType {
  return typeof input === "string" && (TAX_TYPES as readonly string[]).includes(input);
}

export type FormKind = "main" | "annex";

export type ValueType =
  | "text"
  | "select"
  | "radio"
  | "checkbox"
  | "date"
  | "daterange"
  | "note"
  | "repeater";

export interface Line {
  /** As printed in ELSTER (e.g. `"14"`, `"75a"`). Notes have `null`. */
  line_number: string | null;
  /** German label as it appears in the form. */
  label: string;
  value_type: ValueType;
  /** Closed list of allowed values for select/radio types. Empty otherwise. */
  allowed_values: string[];
  /** Page this line lives on (1-based). */
  page_number: number;
  page_label: string;
  /** Visible heading of the enclosing section, or null if the line lives in
   *  a section without a heading. */
  section_label: string | null;
}

export interface Section {
  /** German heading text, or null for unnamed sections. */
  section_label: string | null;
  lines: Line[];
  sections: Section[];
}

export interface Page {
  page_number: number;
  page_label: string;
  sections: Section[];
}

export interface Form {
  slug: string;
  /** Display name derived from the raw upstream directory (umlauts intact). */
  name: string;
  form_kind: FormKind;
  tax_type: TaxType;
  year: string;
  pages: Page[];
  /** Triggers loaded from the trigger-index, if available. */
  triggers: Trigger[];
  /** True if a trigger-index entry exists for this form. */
  triggers_loaded: boolean;
  /** English summary from the trigger-index, if available. */
  description: string | null;
  /** Filing requirement flag from the trigger-index. Defaults to
   *  `form_kind === "main"` when no entry is present. */
  mandatory: boolean;
}

export interface MachineCheck {
  key: string;
  op: ">" | ">=" | "<" | "<=" | "==" | "!=" | "in" | "not_in" | "truthy" | "falsy";
  value: string | number | boolean | string[] | number[] | null;
}

export interface Trigger {
  condition: string;
  machine_check: MachineCheck | null;
  help_source: string;
  confidence: "certain" | "high" | "medium" | "low";
}

export interface HelpMappingEntry {
  form_slug: string;
  line_number: string;
  page_label: string | null;
  help_source: string;
  snippet: string;
}

export interface HelpFile {
  tax_type: TaxType;
  year: string;
  filename: string;
  /** Full text of the markdown file, kept in memory for snippet rendering. */
  source: string;
  /** Parsed heading tree (root is synthetic). Lazy-built on first use? No —
   *  parse eagerly to keep tools deterministic and request paths cold-cache. */
  root: HelpHeadingNode;
  /** Anchor-relative origin: anchors in help-mapping and trigger-index are
   *  computed relative to this node (typically the document's H1/H2 title). */
  docRoot: HelpHeadingNode;
}

export interface HelpHeadingNode {
  level: number;
  title: string;
  /** Slug-joined path relative to the document root (excluding the doc root
   *  itself). Use this to look up nodes by `help_source` anchors. */
  anchor: string;
  /** Body lines as character offsets into the source. Re-rendered on demand. */
  bodyLines: { start: number; end: number };
  children: HelpHeadingNode[];
  parent: HelpHeadingNode | null;
}

export interface Catalogue {
  forms: ReadonlyMap<string, Form>;
  /** All known (tax_type, year) pairs, derived from the forms map. */
  yearsByTaxType: ReadonlyMap<TaxType, readonly string[]>;
  /** Help mappings keyed by `${tax_type}/${year}/${form_slug}/${line_number}`. */
  helpMappings: ReadonlyMap<string, HelpMappingEntry>;
  /** Help files keyed by `${tax_type}/${year}`. */
  helpFiles: ReadonlyMap<string, HelpFile>;
  /** Warnings collected during load (e.g. missing trigger index for a year). */
  warnings: readonly string[];
  /** First-found data_commit string (used for provenance). May be null in
   *  fully degraded mode. */
  dataCommit: string | null;
}

export function formKey(taxType: TaxType, year: string, slug: string): string {
  return `${taxType}/${year}/${slug}`;
}

export function helpMappingKey(
  taxType: TaxType,
  year: string,
  slug: string,
  lineNumber: string
): string {
  return `${taxType}/${year}/${slug}/${lineNumber}`;
}

export function helpFileKey(taxType: TaxType, year: string): string {
  return `${taxType}/${year}`;
}
