import { z } from "zod";

import {
  TAX_TYPES,
  type Form,
  type Page,
  type Section,
  type TaxType,
  type Trigger,
} from "../catalogue/types.js";
import { resolveForm, resolvePage, resolveTaxType, resolveYear } from "./lookups.js";
import type { ToolDefinition } from "./envelope.js";

const TaxTypeSchema = z.enum(TAX_TYPES as ["kst", "gewst", "ust"]);

const TriggerSchema: z.ZodType<Trigger> = z.object({
  condition: z.string(),
  machine_check: z
    .object({
      key: z.string(),
      op: z.enum([">", ">=", "<", "<=", "==", "!=", "in", "not_in", "truthy", "falsy"]),
      value: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.array(z.string()),
          z.array(z.number()),
          z.null(),
        ])
        .nullable(),
    })
    .nullable(),
  help_source: z.string(),
  confidence: z.enum(["certain", "high", "medium", "low"]),
});

interface OutlineLine {
  page_number: number;
  page_label: string;
  section_label: string | null;
  line_number: string | null;
  label: string;
  value_type: string;
}

export const getFormOutlineTool: ToolDefinition<
  { tax_type: TaxType; year: string; form_slug: string },
  {
    slug: string;
    name: string;
    form_kind: "main" | "annex";
    page_count: number;
    lines: OutlineLine[];
  }
> = {
  name: "get_form_outline",
  description:
    "Return a compact line-by-line map of an entire form: page number, page label, section label, line number, label, value_type. No allowed_values, no help text — just the structural backbone, designed to keep one whole form within a 1-3 KB context budget.",
  inputSchema: z
    .object({ tax_type: TaxTypeSchema, year: z.string(), form_slug: z.string() })
    .strict(),
  outputSchema: z.object({
    slug: z.string(),
    name: z.string(),
    form_kind: z.enum(["main", "annex"]),
    page_count: z.number().int().nonnegative(),
    lines: z.array(
      z.object({
        page_number: z.number().int().positive(),
        page_label: z.string(),
        section_label: z.string().nullable(),
        line_number: z.string().nullable(),
        label: z.string(),
        value_type: z.string(),
      })
    ),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const form = resolveForm(ctx.catalogue, taxType, year, input.form_slug);
    const lines: OutlineLine[] = [];
    for (const page of form.pages) {
      for (const section of page.sections) walk(section, page);
    }
    return {
      data: {
        slug: form.slug,
        name: form.name,
        form_kind: form.form_kind,
        page_count: form.pages.length,
        lines,
      },
      source: sourceFor(form),
    };

    function walk(section: Section, page: Page): void {
      for (const line of section.lines) {
        lines.push({
          page_number: page.page_number,
          page_label: page.page_label,
          section_label: section.section_label,
          line_number: line.line_number,
          label: line.label,
          value_type: line.value_type,
        });
      }
      for (const child of section.sections) walk(child, page);
    }
  },
};

export const getFormTriggersTool: ToolDefinition<
  { tax_type: TaxType; year: string; form_slug: string },
  {
    slug: string;
    mandatory: boolean;
    description: string | null;
    triggers_loaded: boolean;
    triggers: Trigger[];
  }
> = {
  name: "get_form_triggers",
  description:
    "Return the structured filing-trigger conditions for one form, as extracted from the official help text by the offline build pipeline. Each trigger carries a German `condition`, an optional `machine_check` that can be evaluated against a session profile, a `help_source` anchor, and a `confidence` label.",
  inputSchema: z
    .object({ tax_type: TaxTypeSchema, year: z.string(), form_slug: z.string() })
    .strict(),
  outputSchema: z.object({
    slug: z.string(),
    mandatory: z.boolean(),
    description: z.string().nullable(),
    triggers_loaded: z.boolean(),
    triggers: z.array(TriggerSchema),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const form = resolveForm(ctx.catalogue, taxType, year, input.form_slug);
    const warnings: string[] = [];
    if (!form.triggers_loaded) {
      warnings.push(
        `No trigger-index entry for ${taxType}/${year}/${form.slug}; defaulting to form_kind-based behaviour.`
      );
    }
    return {
      data: {
        slug: form.slug,
        mandatory: form.mandatory,
        description: form.description,
        triggers_loaded: form.triggers_loaded,
        triggers: form.triggers,
      },
      source: `trigger-index/${taxType}-${year}.json#${form.slug}`,
      warnings,
    };
  },
};

export const listPagesTool: ToolDefinition<
  { tax_type: TaxType; year: string; form_slug: string },
  { slug: string; pages: { page_number: number; page_label: string; line_count: number }[] }
> = {
  name: "list_pages",
  description:
    "Return the page index of one form, with the page number, the page label (form heading shown to the user) and the count of input lines on each page.",
  inputSchema: z
    .object({ tax_type: TaxTypeSchema, year: z.string(), form_slug: z.string() })
    .strict(),
  outputSchema: z.object({
    slug: z.string(),
    pages: z.array(
      z.object({
        page_number: z.number().int().positive(),
        page_label: z.string(),
        line_count: z.number().int().nonnegative(),
      })
    ),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const form = resolveForm(ctx.catalogue, taxType, year, input.form_slug);
    return {
      data: {
        slug: form.slug,
        pages: form.pages.map((p) => ({
          page_number: p.page_number,
          page_label: p.page_label,
          line_count: countLinesInPage(p.sections),
        })),
      },
      source: sourceFor(form),
    };
  },
};

interface FullSection {
  section_label: string | null;
  lines: {
    line_number: string | null;
    label: string;
    value_type: string;
    allowed_values: string[];
  }[];
  sections: FullSection[];
}

export const getPageTool: ToolDefinition<
  { tax_type: TaxType; year: string; form_slug: string; page_number: number },
  {
    slug: string;
    page_number: number;
    page_label: string;
    sections: FullSection[];
  }
> = {
  name: "get_page",
  description:
    "Return the full section/line tree of one page of a form, including `allowed_values` for select/radio lines. Use `get_form_outline` first to find the page number you want.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      form_slug: z.string(),
      page_number: z.number().int().positive(),
    })
    .strict(),
  outputSchema: z.object({
    slug: z.string(),
    page_number: z.number().int().positive(),
    page_label: z.string(),
    sections: z.array(z.unknown()) as unknown as z.ZodType<FullSection[]>,
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const form = resolveForm(ctx.catalogue, taxType, year, input.form_slug);
    const page = resolvePage(form, input.page_number);
    return {
      data: {
        slug: form.slug,
        page_number: page.page_number,
        page_label: page.page_label,
        sections: page.sections.map(serializeSection),
      },
      source: `${sourceFor(form)}, page ${page.page_number} / ${page.page_label}`,
    };
  },
};

function sourceFor(form: Form): string {
  return `${form.name} ${form.year}`;
}

function countLinesInPage(sections: readonly Section[]): number {
  let n = 0;
  const visit = (s: Section): void => {
    for (const line of s.lines) if (line.line_number != null) n++;
    for (const c of s.sections) visit(c);
  };
  for (const s of sections) visit(s);
  return n;
}

function serializeSection(s: Section): FullSection {
  return {
    section_label: s.section_label,
    lines: s.lines.map((l) => ({
      line_number: l.line_number,
      label: l.label,
      value_type: l.value_type,
      allowed_values: [...l.allowed_values],
    })),
    sections: s.sections.map(serializeSection),
  };
}
