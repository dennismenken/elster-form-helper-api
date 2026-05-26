import { z } from "zod";

import { TAX_TYPES, type TaxType } from "../catalogue/types.js";
import { resolveForm, resolveLine, resolveTaxType, resolveYear } from "./lookups.js";
import { validateValue } from "../validator/index.js";
import type { ToolDefinition } from "./envelope.js";

const TaxTypeSchema = z.enum(TAX_TYPES as ["kst", "gewst", "ust"]);

export const validateValueTool: ToolDefinition<
  {
    tax_type: TaxType;
    year: string;
    form_slug: string;
    line_number: string;
    value?: unknown;
  },
  {
    valid: boolean;
    normalized_value?: unknown;
    error: string | null;
    expected_format: string | null;
    value_type: string;
  }
> = {
  name: "validate_value",
  description:
    "Type-check a user-provided value against a form line. Use this before persisting to a session. The check follows the line's `value_type`: text is freeform; select/radio must match an `allowed_values` entry; checkbox must be boolean; date is `DD.MM.YYYY`; daterange is either an object `{from, to}` or a string `DD.MM.YYYY - DD.MM.YYYY` and `to >= from`; notes and repeaters cannot hold values.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      form_slug: z.string(),
      line_number: z.string(),
      value: z.unknown(),
    })
    .strict(),
  outputSchema: z.object({
    valid: z.boolean(),
    normalized_value: z.unknown(),
    error: z.string().nullable(),
    expected_format: z.string().nullable(),
    value_type: z.string(),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const form = resolveForm(ctx.catalogue, taxType, year, input.form_slug);
    const { line } = resolveLine(form, input.line_number);
    const result = validateValue(line, input.value);
    return {
      data: result.valid
        ? {
            valid: true,
            normalized_value: result.normalized_value,
            error: null,
            expected_format: null,
            value_type: line.value_type,
          }
        : {
            valid: false,
            normalized_value: null,
            error: result.error,
            expected_format: result.expected_format ?? null,
            value_type: line.value_type,
          },
      source: `${form.name} ${form.year}, line ${input.line_number} (${line.value_type})`,
    };
  },
};
