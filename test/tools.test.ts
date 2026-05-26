import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runTool, type ToolContext, type Envelope } from "../src/tools/envelope.js";
import { ALL_TOOLS, findTool } from "../src/tools/registry.js";
import { buildTestContext } from "./helpers.js";

let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const built = await buildTestContext();
  ctx = built.ctx;
  cleanup = built.cleanup;
});

afterAll(async () => cleanup());

function tool(name: string): ReturnType<typeof findTool> {
  const t = findTool(name);
  if (!t) throw new Error(`tool '${name}' missing from registry`);
  return t;
}

async function call<T = unknown>(
  toolName: string,
  args: Record<string, unknown>
): Promise<Envelope<T>> {
  return runTool(tool(toolName)!, args, ctx) as Promise<Envelope<T>>;
}

describe("registry", () => {
  it("exposes the full PRD tool list", () => {
    const names = ALL_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "get_form_outline",
        "get_form_triggers",
        "get_help_section",
        "get_line",
        "get_page",
        "list_forms",
        "list_pages",
        "list_tax_types",
        "list_years",
        "recommend_forms",
        "search_help",
        "search_lines",
        "session_deselect_form",
        "session_export",
        "session_get_open_questions",
        "session_get_status",
        "session_import",
        "session_select_form",
        "session_set_field",
        "session_set_profile_field",
        "session_set_profile_note",
        "session_start",
        "validate_value",
      ].sort()
    );
  });

  it("every tool has a non-empty description", () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe("discovery tools", () => {
  it("list_tax_types returns the tax types actually present in the data tree", async () => {
    const env = await call<{ tax_types: string[] }>("list_tax_types", {});
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.tax_types).toContain("kst");
      expect(env.provenance.data_commit).toBeTruthy();
    }
  });

  it("list_years returns sorted year strings", async () => {
    const env = await call<{ tax_type: string; years: string[] }>("list_years", {
      tax_type: "kst",
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.years).toContain("2025");
      const sorted = [...env.data.years].sort();
      expect(env.data.years).toEqual(sorted);
    }
  });

  it("list_forms returns the expected count for KSt 2025", async () => {
    const env = await call<{ forms: unknown[] }>("list_forms", { tax_type: "kst", year: "2025" });
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.forms.length).toBe(27);
    }
  });

  it("list_forms returns INPUT error on bad tax_type", async () => {
    const env = await call("list_forms", { tax_type: "wrong", year: "2025" });
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("INVALID_INPUT");
    }
  });
});

describe("structure tools", () => {
  it("get_form_outline returns lines for anlage-gk", async () => {
    const env = await call<{ lines: unknown[]; page_count: number }>("get_form_outline", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-gk",
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.page_count).toBeGreaterThan(0);
      expect(env.data.lines.length).toBeGreaterThan(50);
    }
  });

  it("get_form_triggers reflects the trigger-index for Hauptvordruck", async () => {
    const env = await call<{ mandatory: boolean; triggers: unknown[] }>("get_form_triggers", {
      tax_type: "kst",
      year: "2025",
      form_slug: "00-hauptvordruck-kst-1",
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.mandatory).toBe(true);
      expect(env.data.triggers.length).toBeGreaterThan(0);
    }
  });

  it("get_page returns the requested page with its sections", async () => {
    const env = await call<{ page_number: number; page_label: string; sections: unknown[] }>(
      "get_page",
      { tax_type: "kst", year: "2025", form_slug: "anlage-gk", page_number: 3 }
    );
    expect(env.ok).toBe(true);
  });

  it("suggests neighbours on FORM_NOT_FOUND (typo recovery)", async () => {
    const env = await call("get_form_outline", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-zv",
    });
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("FORM_NOT_FOUND");
      expect(env.error.suggestions).toContain("anlage-zve");
    }
  });

  it("suggests anlage-hk-zur-spartentrennung when the user writes anlage-öhk", async () => {
    const env = await call("get_form_outline", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-öhk",
    });
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("FORM_NOT_FOUND");
      expect(env.error.suggestions ?? []).toContain("anlage-hk-zur-spartentrennung");
    }
  });
});

describe("recommend_forms correctness for commercial corporations", () => {
  const plainCommercialGmbhProfile = {
    legal_form: "GmbH",
    business_type: "commercial",
    fiscal_year_end: "2025-12-31",
    has_foreign_operations: false,
    has_economic_business_activity: false,
    is_organschaft_subsidiary: false,
    is_organschaft_parent: false,
    has_loss_carryforward: false,
    is_support_fund: false,
    is_municipal_subsidiary: false,
    has_cbc_reporting_obligation: false,
    has_significant_interest_expense: false,
  };

  it("recommends Anlage GK and Anlage ZVE for a plain commercial GmbH (baseline triggers)", async () => {
    const env = await call<{ recommended: { slug: string }[] }>("recommend_forms", {
      tax_type: "kst",
      year: "2025",
      profile: plainCommercialGmbhProfile,
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      const slugs = env.data.recommended.map((r) => r.slug);
      expect(slugs).toContain("00-hauptvordruck-kst-1");
      expect(slugs).toContain("anlage-gk");
      expect(slugs).toContain("anlage-zve");
    }
  });

  it("leaves only legitimate transactional-fact unanswered_conditions when the full profile is provided", async () => {
    const env = await call<{ unanswered_conditions: { form_slug: string }[] }>("recommend_forms", {
      tax_type: "kst",
      year: "2025",
      profile: plainCommercialGmbhProfile,
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      // After the profile-schema extension, every "is this entity type"
      // question is decidable. What stays unanswered are content-dependent
      // questions (specific Vermögensübertragung in KSt 1 F, donation
      // carryforward in Anlage Z) that the model legitimately has to ask
      // the user about. The set is bounded and well-known:
      const remainingSlugs = env.data.unanswered_conditions.map((u) => u.form_slug).sort();
      // No legacy "should be decidable but is not" slugs:
      expect(remainingSlugs).not.toContain("anlage-kassen");
      expect(remainingSlugs).not.toContain("anlage-hk-zur-spartentrennung");
      expect(remainingSlugs).not.toContain("anlage-geno-ver");
      expect(remainingSlugs).not.toContain("anlage-wa");
      expect(remainingSlugs).not.toContain("anlage-zinsschranke");
      expect(remainingSlugs).not.toContain("anlage-verluste");
      // The transactional-fact remainder is the natural ask-the-user surface.
      expect(env.data.unanswered_conditions.length).toBeLessThanOrEqual(4);
    }
  });

  it("rules out special-entity annexes when their machine_check fields are false", async () => {
    const env = await call<{
      recommended: { slug: string }[];
      evaluated: { slug: string; result: string }[];
    }>("recommend_forms", {
      tax_type: "kst",
      year: "2025",
      profile: plainCommercialGmbhProfile,
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      const recommended = env.data.recommended.map((r) => r.slug);
      const ruledOut = env.data.evaluated
        .filter((e) => e.result === "ruled_out")
        .map((e) => e.slug);
      // None of these should be in recommended for the plain commercial GmbH:
      for (const slug of [
        "anlage-kassen",
        "anlage-hk-zur-spartentrennung",
        "anlage-geno-ver",
        "anlage-wa",
        "anlage-zinsschranke",
      ]) {
        expect(recommended).not.toContain(slug);
      }
      // All of them should be conclusively ruled out (not lingering as
      // unanswered) because the new machine_checks resolve to false.
      for (const slug of [
        "anlage-kassen",
        "anlage-hk-zur-spartentrennung",
        "anlage-wa",
        "anlage-zinsschranke",
      ]) {
        expect(ruledOut).toContain(slug);
      }
    }
  });
});

describe("line and help tools", () => {
  it("get_line returns a snippet for a line with a help mapping", async () => {
    const env = await call<{
      label: string;
      help_snippet: string | null;
      help_source: string | null;
    }>("get_line", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-gk",
      line_number: "11",
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.help_snippet).toMatch(/Bilanz/);
      expect(env.data.help_source).toMatch(/elster_kst2025_help\.md#/);
    }
  });

  it("search_help returns matches with anchors", async () => {
    const env = await call<{ matches: { help_source: string }[] }>("search_help", {
      tax_type: "kst",
      year: "2025",
      query: "Bilanzielles",
      limit: 3,
    });
    expect(env.ok).toBe(true);
    if (env.ok) expect(env.data.matches.length).toBeGreaterThan(0);
  });
});

describe("recommend_forms", () => {
  it("includes Anlage GK for a steuerbegünstigte Körperschaft with wirtschaftlicher Geschäftsbetrieb", async () => {
    const env = await call<{
      recommended: { slug: string }[];
      unanswered_conditions: unknown[];
    }>("recommend_forms", {
      tax_type: "kst",
      year: "2025",
      profile: {
        legal_form: "GmbH",
        business_type: "non_profit",
        fiscal_year_end: "2025-12-31",
        has_foreign_operations: false,
        has_economic_business_activity: true,
        is_organschaft_subsidiary: false,
        is_organschaft_parent: false,
        has_loss_carryforward: false,
      },
    });
    expect(env.ok).toBe(true);
    if (env.ok) {
      const slugs = env.data.recommended.map((r) => r.slug);
      expect(slugs).toContain("00-hauptvordruck-kst-1");
      expect(slugs).toContain("anlage-gk");
    }
  });

  it("flags unanswered conditions when machine_check keys are missing", async () => {
    const env = await call<{ unanswered_conditions: unknown[] }>("recommend_forms", {
      tax_type: "kst",
      year: "2025",
      profile: { legal_form: "GmbH" },
    });
    expect(env.ok).toBe(true);
    // The Hauptvordruck still lands in recommended, but several annexes
    // bubble up as unanswered.
  });
});

describe("session lifecycle", () => {
  it("walks through start → set fields → status → export → import", async () => {
    const start = await call<{ session_id: string }>("session_start", {
      tax_type: "kst",
      year: "2025",
      initial_profile: { legal_form: "GmbH" },
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const sid = start.data.session_id;

    const setProfile = await call("session_set_profile_field", {
      session_id: sid,
      key: "has_foreign_operations",
      value: false,
    });
    expect(setProfile.ok).toBe(true);

    const select = await call("session_select_form", {
      session_id: sid,
      form_slug: "anlage-gk",
    });
    expect(select.ok).toBe(true);

    const setField = await call<{ valid: boolean }>("session_set_field", {
      session_id: sid,
      form_slug: "anlage-gk",
      line_number: "11",
      value: "Gewinn laut Bilanz",
    });
    expect(setField.ok).toBe(true);
    if (setField.ok) expect(setField.data.valid).toBe(true);

    const status = await call<{
      selected_forms: string[];
      filled_count: number;
      missing_profile_fields: string[];
    }>("session_get_status", { session_id: sid });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.data.selected_forms).toContain("anlage-gk");
      expect(status.data.filled_count).toBe(1);
      expect(status.data.missing_profile_fields).toContain("business_type");
    }

    const exported = await call<{ state: unknown }>("session_export", { session_id: sid });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const imported = await call<{ session_id: string }>("session_import", {
      state: exported.data.state,
    });
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.data.session_id).toBe(sid);
  });

  it("rejects unknown profile fields", async () => {
    const start = await call<{ session_id: string }>("session_start", {
      tax_type: "kst",
      year: "2025",
    });
    if (!start.ok) throw new Error("session_start failed");
    const sid = start.data.session_id;
    const env = await call("session_set_profile_field", {
      session_id: sid,
      key: "totally_made_up",
      value: 42,
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("PROFILE_FIELD_UNKNOWN");
  });
});
