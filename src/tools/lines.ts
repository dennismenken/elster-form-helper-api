import { z } from "zod";

import { TAX_TYPES, helpMappingKey, type TaxType } from "../catalogue/types.js";
import { searchLines } from "../catalogue/search.js";
import { resolveForm, resolveLine, resolveTaxType, resolveYear } from "./lookups.js";
import type { ToolDefinition } from "./envelope.js";

const TaxTypeSchema = z.enum(TAX_TYPES as ["kst", "gewst", "ust"]);

export const getLineTool: ToolDefinition<
  { tax_type: TaxType; year: string; form_slug: string; line_number: string },
  {
    form_slug: string;
    line_number: string;
    page_number: number;
    page_label: string;
    section_label: string | null;
    label: string;
    value_type: string;
    allowed_values: string[];
    help_snippet: string | null;
    help_source: string | null;
  }
> = {
  name: "get_line",
  description:
    "Return one line of a form with its full metadata: page number, page label, section label, German label, value type, allowed values (for select/radio) and the matching help snippet plus its anchor (when a help mapping is available for this year).",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      form_slug: z.string(),
      line_number: z.string(),
    })
    .strict(),
  outputSchema: z.object({
    form_slug: z.string(),
    line_number: z.string(),
    page_number: z.number().int().positive(),
    page_label: z.string(),
    section_label: z.string().nullable(),
    label: z.string(),
    value_type: z.string(),
    allowed_values: z.array(z.string()),
    help_snippet: z.string().nullable(),
    help_source: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const form = resolveForm(ctx.catalogue, taxType, year, input.form_slug);
    const { line, page, matches } = resolveLine(form, input.line_number);

    const warnings: string[] = [];
    if (matches > 1) {
      warnings.push(
        `Line '${input.line_number}' appears ${matches} times in form '${form.slug}'; returning the first occurrence.`
      );
    }

    const mappingKey = helpMappingKey(taxType, year, form.slug, input.line_number);
    const mapping = ctx.catalogue.helpMappings.get(mappingKey);
    const helpSnippet = mapping?.snippet ?? null;
    const helpSource = mapping?.help_source ?? null;
    if (!mapping) {
      warnings.push(
        `No help mapping for ${taxType}/${year}/${form.slug}:${input.line_number}; help_snippet is null.`
      );
    }

    return {
      data: {
        form_slug: form.slug,
        line_number: input.line_number,
        page_number: page.page_number,
        page_label: page.page_label,
        section_label: line.section_label,
        label: line.label,
        value_type: line.value_type,
        allowed_values: [...line.allowed_values],
        help_snippet: helpSnippet,
        help_source: helpSource,
      },
      source: `${form.name} ${form.year}, page ${page.page_number} / ${page.page_label}, line ${input.line_number}`,
      ...(helpSource ? { helpSource } : {}),
      warnings,
    };
  },
};

export const searchLinesTool: ToolDefinition<
  { tax_type: TaxType; year: string; query: string; limit?: number; form_slug?: string },
  {
    tax_type: TaxType;
    year: string;
    query: string;
    matches: {
      form_slug: string;
      line_number: string;
      page_number: number;
      page_label: string;
      section_label: string | null;
      label: string;
      score: number;
    }[];
  }
> = {
  name: "search_lines",
  description:
    "Search form lines by label (and section/page labels) for one (tax_type, year). Returns up to `limit` highest-scoring matches with their form slug, line number and labels.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(5),
      form_slug: z.string().optional(),
    })
    .strict(),
  outputSchema: z.object({
    tax_type: TaxTypeSchema,
    year: z.string(),
    query: z.string(),
    matches: z.array(
      z.object({
        form_slug: z.string(),
        line_number: z.string(),
        page_number: z.number().int().positive(),
        page_label: z.string(),
        section_label: z.string().nullable(),
        label: z.string(),
        score: z.number(),
      })
    ),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    if (input.form_slug) {
      resolveForm(ctx.catalogue, taxType, year, input.form_slug);
    }
    const opts: { limit: number; formSlug?: string } = { limit: input.limit ?? 5 };
    if (input.form_slug) opts.formSlug = input.form_slug;
    const hits = searchLines(ctx.catalogue, taxType, year, input.query, opts);
    return {
      data: { tax_type: taxType, year, query: input.query, matches: hits },
      source: `search/${taxType}/${year}/lines`,
    };
  },
};
