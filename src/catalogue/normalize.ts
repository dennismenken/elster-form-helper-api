import type { Line, Page, Section, ValueType } from "./types.js";

/**
 * Raw shape of a consolidated form JSON, as produced by the data repo's
 * `formular_daten_generator.py`. Kept tight so the boundary is obvious.
 */
interface RawPage {
  context_label: string | null;
  sections: RawSection[];
}

interface RawSection {
  section_label: string | null;
  rows: RawRow[];
  sections: RawSection[];
}

interface RawRow {
  row: string | null;
  label: string;
  type: string;
  values: string[];
}

/**
 * Translate a raw consolidated form JSON into the catalogue's normalized
 * shape. The raw key names (`context_label`, `row`, `type`, `values`) are
 * unfit for the public tool API — we rename here once, downstream code stays
 * uniform.
 */
export function normalizePages(raw: unknown): Page[] {
  if (!Array.isArray(raw)) {
    throw new TypeError("expected an array at the top of a form JSON file");
  }
  const pages: Page[] = [];
  let pageNumber = 0;
  for (const item of raw) {
    pageNumber += 1;
    const rawPage = item as RawPage;
    const pageLabel = rawPage.context_label ?? `Page ${pageNumber}`;
    const sections = (rawPage.sections ?? []).map((s) =>
      normalizeSection(s, pageNumber, pageLabel)
    );
    pages.push({ page_number: pageNumber, page_label: pageLabel, sections });
  }
  return pages;
}

function normalizeSection(raw: RawSection, pageNumber: number, pageLabel: string): Section {
  const lines: Line[] = (raw.rows ?? []).map((r) =>
    normalizeLine(r, pageNumber, pageLabel, raw.section_label)
  );
  const sections: Section[] = (raw.sections ?? []).map((s) =>
    normalizeSection(s, pageNumber, pageLabel)
  );
  return { section_label: raw.section_label, lines, sections };
}

function normalizeLine(
  raw: RawRow,
  pageNumber: number,
  pageLabel: string,
  sectionLabel: string | null
): Line {
  return {
    line_number: raw.row,
    label: raw.label,
    value_type: normalizeValueType(raw.type),
    allowed_values: Array.isArray(raw.values) ? [...raw.values] : [],
    page_number: pageNumber,
    page_label: pageLabel,
    section_label: sectionLabel,
  };
}

const VALUE_TYPES: ReadonlySet<ValueType> = new Set([
  "text",
  "select",
  "radio",
  "checkbox",
  "date",
  "daterange",
  "note",
  "repeater",
]);

function normalizeValueType(raw: string): ValueType {
  if (VALUE_TYPES.has(raw as ValueType)) return raw as ValueType;
  // Treat unknown types as plain text to avoid crashing on data drift.
  return "text";
}

/**
 * Walk every line in a page tree. The visitor is invoked in document order.
 * Used by outline + search builders.
 */
export function walkLines(pages: readonly Page[], visit: (line: Line, page: Page) => void): void {
  for (const page of pages) {
    for (const section of page.sections) walkSection(section, page, visit);
  }
}

function walkSection(section: Section, page: Page, visit: (line: Line, page: Page) => void): void {
  for (const line of section.lines) visit(line, page);
  for (const child of section.sections) walkSection(child, page, visit);
}
