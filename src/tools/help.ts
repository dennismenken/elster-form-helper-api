import { z } from "zod";

import { ERROR_CODES, ToolError } from "../errors.js";
import { TAX_TYPES, helpFileKey, type TaxType } from "../catalogue/types.js";
import { findHelpNode, renderHelpBody } from "../catalogue/help_tree.js";
import { searchHelp } from "../catalogue/search.js";
import { resolveTaxType, resolveYear } from "./lookups.js";
import type { ToolDefinition } from "./envelope.js";

const TaxTypeSchema = z.enum(TAX_TYPES as ["kst", "gewst", "ust"]);

export const searchHelpTool: ToolDefinition<
  { tax_type: TaxType; year: string; query: string; limit?: number },
  {
    tax_type: TaxType;
    year: string;
    query: string;
    matches: { help_source: string; heading_title: string; snippet: string; score: number }[];
  }
> = {
  name: "search_help",
  description:
    "Full-text search across the official help markdown for one (tax_type, year). Returns up to `limit` matching sections with the anchor (`help_source`) and a snippet, ranked by a simple scored substring algorithm.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(5),
    })
    .strict(),
  outputSchema: z.object({
    tax_type: TaxTypeSchema,
    year: z.string(),
    query: z.string(),
    matches: z.array(
      z.object({
        help_source: z.string(),
        heading_title: z.string(),
        snippet: z.string(),
        score: z.number(),
      })
    ),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const helpFile = ctx.catalogue.helpFiles.get(helpFileKey(taxType, year));
    if (!helpFile) {
      throw new ToolError({
        code: ERROR_CODES.HELP_NOT_FOUND,
        message: `No help markdown is available for ${taxType.toUpperCase()} ${year}.`,
        hint: "Run `npm run sync:help-markdowns` in the elster-forms-data scripts directory and commit the result.",
      });
    }
    const hits = searchHelp(ctx.catalogue, taxType, year, input.query, {
      limit: input.limit ?? 5,
    }).map(({ tax_type: _tt, year: _yr, ...rest }) => rest);
    return {
      data: { tax_type: taxType, year, query: input.query, matches: hits },
      source: `${helpFile.filename}`,
    };
  },
};

export const getHelpSectionTool: ToolDefinition<
  { tax_type: TaxType; year: string; help_source: string; include_children?: boolean },
  {
    tax_type: TaxType;
    year: string;
    help_source: string;
    heading_title: string;
    body: string;
  }
> = {
  name: "get_help_section",
  description:
    "Resolve a `help_source` anchor (the value returned by `get_line` or `search_help`) and return the full markdown body of that section. When `include_children: true`, all descendant sections are concatenated; otherwise only the prose directly under this heading is returned.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      help_source: z.string().min(1),
      include_children: z.boolean().default(true),
    })
    .strict(),
  outputSchema: z.object({
    tax_type: TaxTypeSchema,
    year: z.string(),
    help_source: z.string(),
    heading_title: z.string(),
    body: z.string(),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const helpFile = ctx.catalogue.helpFiles.get(helpFileKey(taxType, year));
    if (!helpFile) {
      throw new ToolError({
        code: ERROR_CODES.HELP_NOT_FOUND,
        message: `No help markdown is available for ${taxType.toUpperCase()} ${year}.`,
      });
    }
    const anchor = stripFilename(input.help_source);
    const node = findHelpNode(helpFile.docRoot, anchor);
    if (!node) {
      throw new ToolError({
        code: ERROR_CODES.HELP_NOT_FOUND,
        message: `Help anchor '${anchor}' not found in ${helpFile.filename}.`,
        hint: "Use `search_help` to discover available anchors.",
      });
    }
    const includeChildren = input.include_children ?? true;
    return {
      data: {
        tax_type: taxType,
        year,
        help_source: `${helpFile.filename}#${anchor}`,
        heading_title: node.title,
        body: renderHelpBody(node, helpFile.source, { includeChildren }),
      },
      source: `${helpFile.filename}#${anchor}`,
      helpSource: `${helpFile.filename}#${anchor}`,
    };
  },
};

function stripFilename(input: string): string {
  const idx = input.indexOf("#");
  return idx >= 0 ? input.slice(idx + 1) : input;
}
