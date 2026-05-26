import { z } from "zod";

import {
  TAX_TYPES,
  type Form,
  type MachineCheck,
  type TaxType,
  type Trigger,
} from "../catalogue/types.js";
import { PROFILE_DEFINITIONS } from "../session/profile_schemas.js";
import { formsByYear, resolveTaxType, resolveYear } from "./lookups.js";
import type { ToolDefinition } from "./envelope.js";

const TaxTypeSchema = z.enum(TAX_TYPES as ["kst", "gewst", "ust"]);

interface RecommendedForm {
  slug: string;
  name: string;
  form_kind: "main" | "annex";
  reasons: {
    condition: string;
    help_source: string;
    confidence: string;
    machine_check: MachineCheck | null;
  }[];
}

interface EvaluatedForm {
  slug: string;
  name: string;
  form_kind: "main" | "annex";
  result: "ruled_out" | "not_applicable";
}

interface UnansweredCondition {
  form_slug: string;
  form_name: string;
  condition: string;
  help_source: string;
  question_for_user: string;
}

export const recommendFormsTool: ToolDefinition<
  {
    tax_type: TaxType;
    year: string;
    profile: Record<string, unknown>;
  },
  {
    tax_type: TaxType;
    year: string;
    recommended: RecommendedForm[];
    evaluated: EvaluatedForm[];
    unanswered_conditions: UnansweredCondition[];
  }
> = {
  name: "recommend_forms",
  description:
    "Given a (tax_type, year) and a user profile, decide which forms to recommend filing. Each form's triggers are evaluated against the profile. Forms with a satisfied trigger land in `recommended`; forms whose triggers conclusively fail land in `evaluated` with result `ruled_out`; forms with no decidable trigger raise an entry in `unanswered_conditions` that the LLM should resolve by asking the user.",
  inputSchema: z
    .object({
      tax_type: TaxTypeSchema,
      year: z.string(),
      profile: z.record(z.unknown()),
    })
    .strict(),
  outputSchema: z.object({
    tax_type: TaxTypeSchema,
    year: z.string(),
    recommended: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        form_kind: z.enum(["main", "annex"]),
        reasons: z.array(
          z.object({
            condition: z.string(),
            help_source: z.string(),
            confidence: z.string(),
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
          })
        ),
      })
    ),
    evaluated: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        form_kind: z.enum(["main", "annex"]),
        result: z.enum(["ruled_out", "not_applicable"]),
      })
    ),
    unanswered_conditions: z.array(
      z.object({
        form_slug: z.string(),
        form_name: z.string(),
        condition: z.string(),
        help_source: z.string(),
        question_for_user: z.string(),
      })
    ),
  }),
  handler: async (input, ctx) => {
    const taxType = resolveTaxType(input.tax_type);
    const year = resolveYear(ctx.catalogue, taxType, input.year);
    const profileDef = PROFILE_DEFINITIONS[taxType];
    const profile = input.profile;
    const validProfileKeys = new Set(Object.keys(profileDef.meta));

    const recommended: RecommendedForm[] = [];
    const evaluated: EvaluatedForm[] = [];
    const unanswered: UnansweredCondition[] = [];

    for (const form of formsByYear(ctx.catalogue, taxType, year)) {
      if (form.mandatory) {
        recommended.push({
          slug: form.slug,
          name: form.name,
          form_kind: form.form_kind,
          reasons:
            form.triggers.length > 0
              ? form.triggers.map(asReason)
              : [
                  {
                    condition: `Form '${form.name}' is mandatory for every ${taxType.toUpperCase()} ${year} return.`,
                    help_source: `catalogue:${form.slug}`,
                    confidence: "certain",
                    machine_check: null,
                  },
                ],
        });
        continue;
      }

      const decided = decideForm(form, profile, validProfileKeys);
      if (decided.recommended.length > 0) {
        recommended.push({
          slug: form.slug,
          name: form.name,
          form_kind: form.form_kind,
          reasons: decided.recommended.map(asReason),
        });
      } else if (decided.unanswered.length > 0) {
        for (const trigger of decided.unanswered) {
          unanswered.push({
            form_slug: form.slug,
            form_name: form.name,
            condition: trigger.condition,
            help_source: trigger.help_source,
            question_for_user: questionForTrigger(trigger),
          });
        }
      } else {
        const result: "ruled_out" | "not_applicable" =
          decided.ruledOut.length > 0 ? "ruled_out" : "not_applicable";
        evaluated.push({
          slug: form.slug,
          name: form.name,
          form_kind: form.form_kind,
          result,
        });
      }
    }

    return {
      data: { tax_type: taxType, year, recommended, evaluated, unanswered_conditions: unanswered },
      source: `recommendation/${taxType}/${year}`,
    };
  },
};

interface FormDecision {
  recommended: Trigger[];
  ruledOut: Trigger[];
  unanswered: Trigger[];
}

function decideForm(
  form: Form,
  profile: Record<string, unknown>,
  validProfileKeys: Set<string>
): FormDecision {
  const decision: FormDecision = { recommended: [], ruledOut: [], unanswered: [] };
  for (const trigger of form.triggers) {
    if (trigger.machine_check == null) {
      decision.unanswered.push(trigger);
      continue;
    }
    if (!validProfileKeys.has(trigger.machine_check.key)) {
      // machine_check references a key we don't know — treat as unanswered
      // so the model surfaces it to the user instead of silently skipping.
      decision.unanswered.push(trigger);
      continue;
    }
    const presentValue = profile[trigger.machine_check.key];
    if (presentValue === undefined || presentValue === null) {
      decision.unanswered.push(trigger);
      continue;
    }
    const outcome = evaluateMachineCheck(trigger.machine_check, presentValue);
    if (outcome === true) decision.recommended.push(trigger);
    else if (outcome === false) decision.ruledOut.push(trigger);
    else decision.unanswered.push(trigger);
  }
  return decision;
}

function evaluateMachineCheck(check: MachineCheck, profileValue: unknown): boolean | null {
  switch (check.op) {
    case "==":
      return scalarEqual(profileValue, check.value);
    case "!=": {
      const eq = scalarEqual(profileValue, check.value);
      return eq == null ? null : !eq;
    }
    case ">":
    case ">=":
    case "<":
    case "<=":
      return compareScalar(check.op, profileValue, check.value);
    case "in":
      return inList(profileValue, check.value);
    case "not_in": {
      const inResult = inList(profileValue, check.value);
      return inResult == null ? null : !inResult;
    }
    case "truthy":
      return Boolean(profileValue) === true;
    case "falsy":
      return Boolean(profileValue) === false;
    default:
      return null;
  }
}

function scalarEqual(a: unknown, b: unknown): boolean | null {
  if (a === undefined || b === undefined) return null;
  return a === b;
}

function compareScalar(op: ">" | ">=" | "<" | "<=", a: unknown, b: unknown): boolean | null {
  if (typeof a !== "number" || typeof b !== "number") return null;
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
  }
}

function inList(value: unknown, list: unknown): boolean | null {
  if (!Array.isArray(list)) return null;
  return list.includes(value);
}

function asReason(t: Trigger): RecommendedForm["reasons"][number] {
  return {
    condition: t.condition,
    help_source: t.help_source,
    confidence: t.confidence,
    machine_check: t.machine_check,
  };
}

function questionForTrigger(trigger: Trigger): string {
  // For machine-checkable triggers we can phrase a sharper question; otherwise
  // we re-use the trigger's German condition as the prompt.
  if (trigger.machine_check) {
    return `Trifft folgende Bedingung zu? ${trigger.condition}`;
  }
  return `Bitte prüfen Sie: ${trigger.condition}`;
}
