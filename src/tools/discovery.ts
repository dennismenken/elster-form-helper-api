import { z } from "zod";

import { TAX_TYPES, type Form, type Section, type TaxType } from "../catalogue/types.js";
import { formsByYear, resolveTaxType, resolveYear } from "./lookups.js";
import type { ToolDefinition } from "./envelope.js";

const TaxTypeSchema = z.enum(TAX_TYPES as ["kst", "gewst", "ust"]);

export const listTaxTypesTool: ToolDefinition<Record<string, never>, { tax_types: TaxType[] }> = {
  name: "list_tax_types",
  description: "Return the closed list of tax types this server can serve (`kst`, `gewst`, `ust`).",
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({
    tax_types: z.array(TaxTypeSchema),
  }),
  handler: async (_input, ctx) => {
    const present: TaxType[] = [];
    for (const t of TAX_TYPES) {
      if (ctx.catalogue.yearsByTaxType.has(t)) present.push(t);
    }
    return {
      data: { tax_types: present },
      source: "catalogue/tax_types",
    };
  },
};

export const listYearsTool: ToolDefinition<
  { tax_type: TaxType },
  { tax_type: TaxType; years: string[] }
> = {
  name: "list_years",
  description:
    "Return the available years for one tax type. Each year corresponds to a directory under `src/data/forms/{tax_type}/`.",
  inputSchema: z.object({ tax_type: TaxTypeSchema }).strict(),
  outputSchema: z.object({
    tax_type: TaxTypeSchema,
    years: z.array(z.string().regex(/^\d{4}$/)),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const years = ctx.catalogue.yearsByTaxType.get(taxType) ?? [];
    return {
      data: { tax_type: taxType, years: [...years] },
      source: `catalogue/${taxType}`,
    };
  },
};

interface FormListItem {
  slug: string;
  name: string;
  form_kind: "main" | "annex";
  mandatory: boolean;
  description: string | null;
  page_count: number;
  line_count: number;
}

export const listFormsTool: ToolDefinition<
  { tax_type: TaxType; year: string; filter?: string },
  { tax_type: TaxType; year: string; forms: FormListItem[] }
> = {
  name: "list_forms",
  description:
    "Return every form (main + annexes) available for one (tax_type, year). Each entry carries the slug used by every other tool, the human-readable name, whether the form is mandatory, an English summary (when a trigger-index entry exists), and basic structural counts.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string().regex(/^\d{4}$/),
      filter: z.string().optional(),
    })
    .strict(),
  outputSchema: z.object({
    tax_type: TaxTypeSchema,
    year: z.string(),
    forms: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        form_kind: z.enum(["main", "annex"]),
        mandatory: z.boolean(),
        description: z.string().nullable(),
        page_count: z.number().int().nonnegative(),
        line_count: z.number().int().nonnegative(),
      })
    ),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const filter = input.filter?.toLowerCase();
    const items: FormListItem[] = [];
    for (const form of formsByYear(ctx.catalogue, taxType, year)) {
      if (filter && !matchesFilter(form, filter)) continue;
      items.push({
        slug: form.slug,
        name: form.name,
        form_kind: form.form_kind,
        mandatory: form.mandatory,
        description: form.description,
        page_count: form.pages.length,
        line_count: countLines(form),
      });
    }
    return {
      data: { tax_type: taxType, year, forms: items },
      source: `catalogue/${taxType}/${year}`,
    };
  },
};

function countLines(form: Form): number {
  let n = 0;
  const visit = (s: Section): void => {
    for (const line of s.lines) if (line.line_number != null) n++;
    for (const c of s.sections) visit(c);
  };
  for (const p of form.pages) for (const s of p.sections) visit(s);
  return n;
}

function matchesFilter(form: Form, filter: string): boolean {
  return (
    form.slug.toLowerCase().includes(filter) ||
    form.name.toLowerCase().includes(filter) ||
    (form.description?.toLowerCase().includes(filter) ?? false)
  );
}
