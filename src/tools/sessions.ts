import { nanoid } from "nanoid";
import { z } from "zod";

import { ERROR_CODES, ToolError } from "../errors.js";
import { TAX_TYPES, type Section, type TaxType } from "../catalogue/types.js";
import { PROFILE_DEFINITIONS } from "../session/profile_schemas.js";
import { SessionFileSchema, type SessionFile } from "../session/types.js";
import { validateValue } from "../validator/index.js";
import { formsByYear, resolveForm, resolveLine, resolveTaxType, resolveYear } from "./lookups.js";
import type { ToolDefinition } from "./envelope.js";

const TaxTypeSchema = z.enum(TAX_TYPES as ["kst", "gewst", "ust"]);

function nowIso(): string {
  return new Date().toISOString();
}

function newSessionId(): string {
  // 21-char URL-safe ID. Random; collision risk is negligible at human scale.
  return nanoid();
}

export const sessionStartTool: ToolDefinition<
  {
    tax_type: TaxType;
    year: string;
    initial_profile?: Record<string, unknown>;
    notes?: Record<string, string>;
  },
  {
    session_id: string;
    tax_type: TaxType;
    year: string;
    profile: { required: Record<string, unknown>; notes: Record<string, string> };
  }
> = {
  name: "session_start",
  description:
    "Create a new session for one (tax_type, year). Returns a `session_id` that subsequent `session_*` tools use to address this state. Optional `initial_profile` lets the caller seed the typed profile fields; unknown keys are rejected.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      initial_profile: z.record(z.unknown()).optional(),
      notes: z.record(z.string()).optional(),
    })
    .strict(),
  outputSchema: z.object({
    session_id: z.string(),
    tax_type: TaxTypeSchema,
    year: z.string(),
    profile: z.object({
      required: z.record(z.unknown()),
      notes: z.record(z.string()),
    }),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const def = PROFILE_DEFINITIONS[taxType];

    const required = def.emptyProfile();
    if (input.initial_profile) {
      for (const [key, value] of Object.entries(input.initial_profile)) {
        if (!(key in required)) {
          throw new ToolError({
            code: ERROR_CODES.PROFILE_FIELD_UNKNOWN,
            message: `Unknown profile field '${key}' for tax type '${taxType}'.`,
            suggestions: def.fieldOrder.slice(),
          });
        }
        required[key] = value;
      }
      const parsed = def.schema.safeParse(required);
      if (!parsed.success) {
        throw new ToolError({
          code: ERROR_CODES.PROFILE_FIELD_INVALID,
          message: "initial_profile failed schema validation.",
          field_errors: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
    }

    const session: SessionFile = {
      session_id: newSessionId(),
      created_at: nowIso(),
      updated_at: nowIso(),
      tax_type: taxType,
      year,
      data_commit: ctx.provenance.dataCommit,
      user_profile: { required, notes: input.notes ?? {} },
      selected_forms: [],
      filled_values: {},
    };
    await ctx.sessionStore.save(session);
    return {
      data: {
        session_id: session.session_id,
        tax_type: taxType,
        year,
        profile: session.user_profile,
      },
      source: `session/${session.session_id}`,
    };
  },
};

export const sessionSetProfileFieldTool: ToolDefinition<
  { session_id: string; key: string; value?: unknown },
  {
    session_id: string;
    profile: { required: Record<string, unknown>; notes: Record<string, string> };
  }
> = {
  name: "session_set_profile_field",
  description:
    "Set one typed profile field on an existing session. The field must exist in the per-tax-type schema; values are validated before persistence.",
  inputSchema: z
    .object({
      session_id: z.string().min(1),
      key: z.string().min(1),
      value: z.unknown(),
    })
    .strict(),
  outputSchema: z.object({
    session_id: z.string(),
    profile: z.object({ required: z.record(z.unknown()), notes: z.record(z.string()) }),
  }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    const def = PROFILE_DEFINITIONS[session.tax_type];
    if (!(input.key in session.user_profile.required)) {
      throw new ToolError({
        code: ERROR_CODES.PROFILE_FIELD_UNKNOWN,
        message: `Unknown profile field '${input.key}' for tax type '${session.tax_type}'.`,
        suggestions: def.fieldOrder.slice(),
      });
    }
    const candidate = { ...session.user_profile.required, [input.key]: input.value };
    const parsed = def.schema.safeParse(candidate);
    if (!parsed.success) {
      throw new ToolError({
        code: ERROR_CODES.PROFILE_FIELD_INVALID,
        message: `Value rejected by schema for field '${input.key}'.`,
        field_errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    session.user_profile.required = candidate;
    session.updated_at = nowIso();
    await ctx.sessionStore.save(session);
    return {
      data: { session_id: session.session_id, profile: session.user_profile },
      source: `session/${session.session_id}`,
    };
  },
};

export const sessionSetProfileNoteTool: ToolDefinition<
  { session_id: string; key: string; value: string },
  { session_id: string; notes: Record<string, string> }
> = {
  name: "session_set_profile_note",
  description:
    "Store an arbitrary free-form note on the session profile. Useful for user-case details that don't fit the typed profile schema.",
  inputSchema: z
    .object({
      session_id: z.string().min(1),
      key: z.string().min(1),
      value: z.string(),
    })
    .strict(),
  outputSchema: z.object({
    session_id: z.string(),
    notes: z.record(z.string()),
  }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    session.user_profile.notes = { ...session.user_profile.notes, [input.key]: input.value };
    session.updated_at = nowIso();
    await ctx.sessionStore.save(session);
    return {
      data: { session_id: session.session_id, notes: session.user_profile.notes },
      source: `session/${session.session_id}`,
    };
  },
};

export const sessionSetFieldTool: ToolDefinition<
  { session_id: string; form_slug: string; line_number: string; value?: unknown },
  {
    session_id: string;
    form_slug: string;
    line_number: string;
    valid: boolean;
    error: string | null;
    expected_format: string | null;
    filled_count: number;
  }
> = {
  name: "session_set_field",
  description:
    "Validate and persist a value for one form line in the session. The value is checked against the line's `value_type` first; on failure the session is not modified.",
  inputSchema: z
    .object({
      session_id: z.string().min(1),
      form_slug: z.string(),
      line_number: z.string(),
      value: z.unknown(),
    })
    .strict(),
  outputSchema: z.object({
    session_id: z.string(),
    form_slug: z.string(),
    line_number: z.string(),
    valid: z.boolean(),
    error: z.string().nullable(),
    expected_format: z.string().nullable(),
    filled_count: z.number().int().nonnegative(),
  }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    const form = resolveForm(ctx.catalogue, session.tax_type, session.year, input.form_slug);
    const { line } = resolveLine(form, input.line_number);
    const validation = validateValue(line, input.value);
    if (!validation.valid) {
      return {
        data: {
          session_id: session.session_id,
          form_slug: form.slug,
          line_number: input.line_number,
          valid: false,
          error: validation.error,
          expected_format: validation.expected_format ?? null,
          filled_count: Object.keys(session.filled_values).length,
        },
        source: `session/${session.session_id}`,
      };
    }
    const key = `${form.slug}:${input.line_number}`;
    session.filled_values = { ...session.filled_values, [key]: validation.normalized_value };
    session.updated_at = nowIso();
    await ctx.sessionStore.save(session);
    return {
      data: {
        session_id: session.session_id,
        form_slug: form.slug,
        line_number: input.line_number,
        valid: true,
        error: null,
        expected_format: null,
        filled_count: Object.keys(session.filled_values).length,
      },
      source: `session/${session.session_id}`,
    };
  },
};

const SelectShape = z.object({ session_id: z.string().min(1), form_slug: z.string() }).strict();

export const sessionSelectFormTool: ToolDefinition<
  z.infer<typeof SelectShape>,
  { session_id: string; selected_forms: string[] }
> = {
  name: "session_select_form",
  description:
    "Add one form to the session's `selected_forms` list (deduplicated). Use after `recommend_forms` to record the user's chosen scope.",
  inputSchema: SelectShape,
  outputSchema: z.object({ session_id: z.string(), selected_forms: z.array(z.string()) }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    resolveForm(ctx.catalogue, session.tax_type, session.year, input.form_slug);
    if (!session.selected_forms.includes(input.form_slug)) {
      session.selected_forms = [...session.selected_forms, input.form_slug].sort();
      session.updated_at = nowIso();
      await ctx.sessionStore.save(session);
    }
    return {
      data: { session_id: session.session_id, selected_forms: session.selected_forms },
      source: `session/${session.session_id}`,
    };
  },
};

export const sessionDeselectFormTool: ToolDefinition<
  z.infer<typeof SelectShape>,
  { session_id: string; selected_forms: string[] }
> = {
  name: "session_deselect_form",
  description:
    "Remove one form from the session's `selected_forms`. Filled values for that form are kept (use a future `session_clear_form_values` tool to drop them when needed).",
  inputSchema: SelectShape,
  outputSchema: z.object({ session_id: z.string(), selected_forms: z.array(z.string()) }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    const before = session.selected_forms.length;
    session.selected_forms = session.selected_forms.filter((s) => s !== input.form_slug);
    if (session.selected_forms.length !== before) {
      session.updated_at = nowIso();
      await ctx.sessionStore.save(session);
    }
    return {
      data: { session_id: session.session_id, selected_forms: session.selected_forms },
      source: `session/${session.session_id}`,
    };
  },
};

export const sessionGetStatusTool: ToolDefinition<
  { session_id: string },
  {
    session_id: string;
    tax_type: TaxType;
    year: string;
    selected_forms: string[];
    filled_count: number;
    total_required_fields_estimate: number;
    missing_profile_fields: string[];
    last_updated_at: string;
  }
> = {
  name: "session_get_status",
  description:
    "Return a compact status snapshot of the session: selected forms, number of filled values, an estimate of how many form lines remain to fill, and the list of typed profile fields still unanswered. Use this to know what to do next without loading the whole session blob.",
  inputSchema: z.object({ session_id: z.string().min(1) }).strict(),
  outputSchema: z.object({
    session_id: z.string(),
    tax_type: TaxTypeSchema,
    year: z.string(),
    selected_forms: z.array(z.string()),
    filled_count: z.number().int().nonnegative(),
    total_required_fields_estimate: z.number().int().nonnegative(),
    missing_profile_fields: z.array(z.string()),
    last_updated_at: z.string(),
  }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    const def = PROFILE_DEFINITIONS[session.tax_type];
    const missing = def.fieldOrder.filter(
      (k) =>
        session.user_profile.required[k] === null || session.user_profile.required[k] === undefined
    );
    let total = 0;
    for (const slug of session.selected_forms) {
      const form = ctx.catalogue.forms.get(`${session.tax_type}/${session.year}/${slug}`);
      if (!form) continue;
      for (const page of form.pages) {
        for (const s of page.sections) {
          const count = countEnterableLines(s);
          total += count;
        }
      }
    }
    return {
      data: {
        session_id: session.session_id,
        tax_type: session.tax_type,
        year: session.year,
        selected_forms: session.selected_forms,
        filled_count: Object.keys(session.filled_values).length,
        total_required_fields_estimate: total,
        missing_profile_fields: missing,
        last_updated_at: session.updated_at,
      },
      source: `session/${session.session_id}`,
    };
  },
};

function countEnterableLines(section: Section): number {
  let n = 0;
  for (const line of section.lines) {
    if (line.line_number != null && line.value_type !== "note" && line.value_type !== "repeater") {
      n++;
    }
  }
  for (const c of section.sections) n += countEnterableLines(c);
  return n;
}

export const sessionGetOpenQuestionsTool: ToolDefinition<
  { session_id: string },
  {
    session_id: string;
    open_profile_fields: {
      key: string;
      current_value?: unknown;
      question_for_user: string;
      impact: string;
    }[];
    unanswered_form_conditions: {
      form_slug: string;
      condition: string;
      question_for_user: string;
      help_source: string;
    }[];
  }
> = {
  name: "session_get_open_questions",
  description:
    "Return the closed list of things this server cannot yet decide about the user case: typed profile fields still set to `null` plus annex trigger conditions whose `machine_check` is null. Each entry carries a German `question_for_user` suggestion the LLM can read to the user verbatim.",
  inputSchema: z.object({ session_id: z.string().min(1) }).strict(),
  outputSchema: z.object({
    session_id: z.string(),
    open_profile_fields: z.array(
      z.object({
        key: z.string(),
        current_value: z.unknown(),
        question_for_user: z.string(),
        impact: z.string(),
      })
    ),
    unanswered_form_conditions: z.array(
      z.object({
        form_slug: z.string(),
        condition: z.string(),
        question_for_user: z.string(),
        help_source: z.string(),
      })
    ),
  }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    const def = PROFILE_DEFINITIONS[session.tax_type];
    const profile = session.user_profile.required;

    const openProfile = def.fieldOrder
      .filter((k) => profile[k] === null || profile[k] === undefined)
      .map((k) => ({
        key: k,
        current_value: profile[k] ?? null,
        question_for_user: def.meta[k]!.question_de,
        impact: def.meta[k]!.impact_de,
      }));

    const unanswered: {
      form_slug: string;
      condition: string;
      question_for_user: string;
      help_source: string;
    }[] = [];
    for (const form of formsByYear(ctx.catalogue, session.tax_type, session.year)) {
      for (const trigger of form.triggers) {
        if (trigger.machine_check == null) {
          unanswered.push({
            form_slug: form.slug,
            condition: trigger.condition,
            question_for_user: `Bitte prüfen Sie: ${trigger.condition}`,
            help_source: trigger.help_source,
          });
        } else if (
          profile[trigger.machine_check.key] === null ||
          profile[trigger.machine_check.key] === undefined
        ) {
          // Machine-checkable but waiting on a missing profile field — covered
          // by `open_profile_fields`, no extra entry needed here.
        }
      }
    }

    return {
      data: {
        session_id: session.session_id,
        open_profile_fields: openProfile,
        unanswered_form_conditions: unanswered,
      },
      source: `session/${session.session_id}`,
    };
  },
};

export const sessionExportTool: ToolDefinition<
  { session_id: string },
  { session_id: string; state: SessionFile }
> = {
  name: "session_export",
  description:
    "Return the full session JSON blob. The LLM stores this as state and pipes it back into the next session with `session_import` after a context-overflow recovery.",
  inputSchema: z.object({ session_id: z.string().min(1) }).strict(),
  outputSchema: z.object({
    session_id: z.string(),
    state: SessionFileSchema,
  }),
  handler: async (input, ctx) => {
    const session = await ctx.sessionStore.load(input.session_id);
    return {
      data: { session_id: session.session_id, state: session },
      source: `session/${session.session_id}`,
    };
  },
};

export const sessionImportTool: ToolDefinition<{ state?: unknown }, { session_id: string }> = {
  name: "session_import",
  description:
    "Persist a session blob previously returned by `session_export`. Re-uses the original `session_id`; overwrites any existing session under that id.",
  inputSchema: z.object({ state: z.unknown() }).strict(),
  outputSchema: z.object({ session_id: z.string() }),
  handler: async (input, ctx) => {
    let parsed;
    try {
      parsed = SessionFileSchema.parse(input.state);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ToolError({
          code: ERROR_CODES.INVALID_INPUT,
          message: "session_import: state blob failed schema validation.",
          field_errors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      throw err;
    }
    await ctx.sessionStore.save(parsed);
    return {
      data: { session_id: parsed.session_id },
      source: `session/${parsed.session_id}`,
    };
  },
};
