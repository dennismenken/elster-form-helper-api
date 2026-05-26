import { ERROR_CODES, ToolError } from "../errors.js";
import { nearestNeighbours } from "../catalogue/search.js";
import {
  formKey,
  isTaxType,
  type Catalogue,
  type Form,
  type Line,
  type Page,
  type Section,
  type TaxType,
} from "../catalogue/types.js";

/**
 * Shared resolver helpers. Every tool that takes a `(tax_type, year, form_slug)`
 * triple goes through these so error messages and "did-you-mean" suggestions
 * stay consistent.
 */

export function resolveTaxType(input: string): TaxType {
  if (!isTaxType(input)) {
    throw new ToolError({
      code: ERROR_CODES.TAX_TYPE_NOT_FOUND,
      message: `Unknown tax_type '${input}'.`,
      hint: "Call `list_tax_types` to see the available values.",
      suggestions: ["kst", "gewst", "ust"],
    });
  }
  return input;
}

export function resolveYear(catalogue: Catalogue, taxType: TaxType, year: string): string {
  const years = catalogue.yearsByTaxType.get(taxType) ?? [];
  if (years.includes(year)) return year;
  throw new ToolError({
    code: ERROR_CODES.YEAR_NOT_FOUND,
    message: `No data for ${taxType.toUpperCase()} ${year}.`,
    hint: `Call \`list_years({ tax_type: "${taxType}" })\` to see the available years.`,
    suggestions: [...years],
  });
}

export function resolveForm(
  catalogue: Catalogue,
  taxType: TaxType,
  year: string,
  formSlug: string
): Form {
  const key = formKey(taxType, year, formSlug);
  const direct = catalogue.forms.get(key);
  if (direct) return direct;
  const candidates = formsByYear(catalogue, taxType, year).map((f) => f.slug);
  const suggestions = nearestNeighbours(candidates, formSlug, 3);
  throw new ToolError({
    code: ERROR_CODES.FORM_NOT_FOUND,
    message: `Form '${formSlug}' does not exist for ${taxType.toUpperCase()} ${year}.`,
    hint: `Call \`list_forms({ tax_type: "${taxType}", year: "${year}" })\` to see the available slugs.`,
    suggestions,
  });
}

export function resolveLine(
  form: Form,
  lineNumber: string
): {
  line: Line;
  page: Page;
  section: Section | null;
  matches: number;
} {
  const matches: { line: Line; page: Page; section: Section | null }[] = [];
  for (const page of form.pages) {
    for (const section of page.sections) collect(section, page, null);
  }
  if (matches.length === 0) {
    const all = enumerateLineNumbers(form);
    const suggestions = nearestNeighbours(all, lineNumber, 3);
    throw new ToolError({
      code: ERROR_CODES.LINE_NOT_FOUND,
      message: `Line '${lineNumber}' does not exist in form '${form.slug}'.`,
      hint: "Call `get_form_outline` for a full map of the form.",
      suggestions,
    });
  }
  return { ...matches[0]!, matches: matches.length };

  function collect(section: Section, page: Page, parent: Section | null): void {
    for (const line of section.lines) {
      if (line.line_number === lineNumber) matches.push({ line, page, section });
    }
    for (const child of section.sections) collect(child, page, section);
    void parent;
  }
}

export function resolvePage(form: Form, pageNumber: number): Page {
  for (const page of form.pages) {
    if (page.page_number === pageNumber) return page;
  }
  throw new ToolError({
    code: ERROR_CODES.PAGE_NOT_FOUND,
    message: `Page ${pageNumber} does not exist in form '${form.slug}'.`,
    hint: `This form has ${form.pages.length} page(s). Call \`list_pages\` for an overview.`,
  });
}

export function formsByYear(catalogue: Catalogue, taxType: TaxType, year: string): Form[] {
  const out: Form[] = [];
  for (const form of catalogue.forms.values()) {
    if (form.tax_type === taxType && form.year === year) out.push(form);
  }
  out.sort((a, b) => {
    if (a.form_kind !== b.form_kind) return a.form_kind === "main" ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
  return out;
}

export function enumerateLineNumbers(form: Form): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (section: Section): void => {
    for (const line of section.lines) {
      if (line.line_number == null) continue;
      if (seen.has(line.line_number)) continue;
      seen.add(line.line_number);
      out.push(line.line_number);
    }
    for (const child of section.sections) visit(child);
  };
  for (const page of form.pages) for (const section of page.sections) visit(section);
  return out;
}
