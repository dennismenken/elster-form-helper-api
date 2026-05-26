/**
 * End-to-end smoke walkthrough. Spawns the compiled MCP server over stdio
 * using the official SDK client, then drives it through the worked example
 * from the PRD (§17): list tax types, start a session, fill the profile,
 * recommend forms, fetch an outline, write a line, export and re-import.
 *
 * Run: `npm run smoke`
 *
 * Exits 0 on success, 1 on any assertion failure. Output is human-readable
 * Markdown so a reviewer can scan the trace quickly.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const serverScript = path.join(repoRoot, "dist", "index.js");

interface ToolEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  provenance?: { data_commit: string; source: string; help_source?: string };
  warnings?: string[];
  error?: { code: string; message: string; suggestions?: string[] };
}

const failures: string[] = [];
let stepCount = 0;

function header(title: string): void {
  stepCount++;
  console.log(`\n## ${stepCount}. ${title}`);
}

function summarize(value: unknown, max = 280): string {
  const json = JSON.stringify(value, null, 2);
  return json.length > max ? `${json.slice(0, max)} …(${json.length} bytes)` : json;
}

function expect(condition: boolean, label: string): void {
  if (condition) {
    console.log(`   ok  ${label}`);
  } else {
    console.log(`   FAIL ${label}`);
    failures.push(label);
  }
}

async function callTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolEnvelope<T>> {
  const result = await client.callTool({ name, arguments: args });
  const structured = (result as { structuredContent?: ToolEnvelope<T> }).structuredContent;
  if (structured && typeof structured === "object") return structured;
  // Fallback: parse the text block (the server always emits structured too,
  // so this only triggers if something is very wrong).
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      return JSON.parse(block.text) as ToolEnvelope<T>;
    }
  }
  throw new Error(`tool ${name} returned no usable content`);
}

async function main(): Promise<void> {
  console.log(`# elster-forms-api smoke walkthrough`);
  console.log(`server: ${path.relative(repoRoot, serverScript)}`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript, "--transport", "stdio", "--log-level", "warn"],
    stderr: "inherit",
  });
  const client = new Client({ name: "smoke-walkthrough", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);

  try {
    header("MCP initialize handshake");
    const serverVersion = client.getServerVersion();
    const instructions = client.getInstructions();
    expect(Boolean(serverVersion?.name), `serverInfo.name present (${serverVersion?.name ?? ""})`);
    expect(
      Boolean(instructions) && instructions.includes("elster-forms"),
      "initialize instructions mention elster-forms"
    );

    header("tools/list returns every registered tool");
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    console.log(`   tools (${names.length}): ${names.join(", ")}`);
    expect(names.length === 23, `tools count is 23 (got ${names.length})`);
    expect(names.includes("list_tax_types"), "list_tax_types registered");
    expect(names.includes("session_get_open_questions"), "session_get_open_questions registered");

    header("Discovery: list_tax_types + list_years");
    const taxes = await callTool<{ tax_types: string[] }>(client, "list_tax_types", {});
    console.log(`   ${summarize(taxes)}`);
    expect(taxes.ok && taxes.data?.tax_types.includes("kst") === true, "kst is present");
    const years = await callTool<{ years: string[] }>(client, "list_years", { tax_type: "kst" });
    expect(years.ok && years.data?.years.includes("2025") === true, "kst 2025 is present");
    expect(
      typeof taxes.provenance?.data_commit === "string" && taxes.provenance.data_commit.length > 0,
      `provenance.data_commit set (${taxes.provenance?.data_commit ?? ""})`
    );

    header("Discovery: list_forms for KSt 2025");
    const forms = await callTool<{ forms: Array<{ slug: string; mandatory: boolean }> }>(
      client,
      "list_forms",
      { tax_type: "kst", year: "2025" }
    );
    expect(forms.ok && (forms.data?.forms.length ?? 0) === 27, "KSt 2025 has 27 forms");
    const mandatory = forms.data?.forms.filter((f) => f.mandatory).map((f) => f.slug) ?? [];
    console.log(`   mandatory forms: ${mandatory.join(", ")}`);
    expect(mandatory.includes("00-hauptvordruck-kst-1"), "Hauptvordruck flagged mandatory");

    header("Session lifecycle: start with partial profile");
    const session = await callTool<{ session_id: string }>(client, "session_start", {
      tax_type: "kst",
      year: "2025",
      initial_profile: { legal_form: "GmbH" },
    });
    expect(session.ok, "session_start ok");
    const sessionId = session.data!.session_id;
    console.log(`   session_id=${sessionId}`);

    header("Session: open profile questions");
    const open = await callTool<{
      open_profile_fields: Array<{ key: string; question_for_user: string }>;
    }>(client, "session_get_open_questions", { session_id: sessionId });
    const openKeys = open.data?.open_profile_fields.map((f) => f.key) ?? [];
    console.log(`   missing: ${openKeys.join(", ")}`);
    expect(openKeys.includes("has_economic_business_activity"), "open includes has_economic_business_activity");
    expect(!openKeys.includes("legal_form"), "legal_form is filled (not open)");

    header("Session: fill the rest of the profile");
    const fills: Record<string, unknown> = {
      business_type: "non_profit",
      fiscal_year_end: "2025-12-31",
      has_foreign_operations: false,
      has_economic_business_activity: true,
      is_organschaft_subsidiary: false,
      is_organschaft_parent: false,
      has_loss_carryforward: false,
    };
    for (const [key, value] of Object.entries(fills)) {
      const res = await callTool(client, "session_set_profile_field", {
        session_id: sessionId,
        key,
        value,
      });
      expect(res.ok, `session_set_profile_field(${key}) ok`);
    }

    header("Recommend forms against the completed profile");
    const reco = await callTool<{
      recommended: Array<{ slug: string }>;
      unanswered_conditions: unknown[];
      evaluated: unknown[];
    }>(client, "recommend_forms", {
      tax_type: "kst",
      year: "2025",
      profile: { legal_form: "GmbH", ...fills },
    });
    const recoSlugs = reco.data?.recommended.map((r) => r.slug) ?? [];
    console.log(`   recommended (${recoSlugs.length}): ${recoSlugs.join(", ")}`);
    console.log(`   unanswered_conditions: ${reco.data?.unanswered_conditions.length ?? 0}`);
    console.log(`   evaluated: ${reco.data?.evaluated.length ?? 0}`);
    expect(recoSlugs.includes("00-hauptvordruck-kst-1"), "Hauptvordruck recommended");
    expect(recoSlugs.includes("anlage-gk"), "anlage-gk recommended (has_economic_business_activity=true)");
    expect(recoSlugs.includes("anlage-zve"), "anlage-zve recommended");
    expect(recoSlugs.includes("anlage-gem"), "anlage-gem recommended (business_type=non_profit)");
    expect(!recoSlugs.includes("anlage-aest"), "anlage-aest NOT recommended (has_foreign_operations=false)");

    header("Form outline: anlage-gk");
    const outline = await callTool<{ lines: Array<{ line_number: string | null }> }>(
      client,
      "get_form_outline",
      { tax_type: "kst", year: "2025", form_slug: "anlage-gk" }
    );
    const totalLines = outline.data?.lines.length ?? 0;
    console.log(`   lines: ${totalLines}`);
    expect(totalLines > 100, `anlage-gk has > 100 outline entries (got ${totalLines})`);

    header("Get line + help snippet: anlage-gk:11");
    const line = await callTool<{
      label: string;
      help_snippet: string | null;
      help_source: string | null;
    }>(client, "get_line", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-gk",
      line_number: "11",
    });
    console.log(`   label: ${line.data?.label.slice(0, 90)}…`);
    console.log(`   help_source: ${line.data?.help_source ?? "null"}`);
    console.log(`   snippet: ${(line.data?.help_snippet ?? "").slice(0, 120)}…`);
    expect(line.ok, "get_line ok");
    expect((line.data?.help_snippet ?? "").length > 0, "help_snippet is non-empty");

    header("Fuzzy suggestion on wrong slug");
    const bad = await callTool(client, "get_form_outline", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-zv",
    });
    console.log(`   error.code: ${bad.error?.code}`);
    console.log(`   suggestions: ${(bad.error?.suggestions ?? []).join(", ")}`);
    expect(bad.ok === false, "wrong slug rejected");
    expect((bad.error?.suggestions ?? []).includes("anlage-zve"), "suggests anlage-zve");

    header("Validation: bad date + good date");
    const badDate = await callTool<{ valid: boolean }>(client, "validate_value", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-gk",
      line_number: "2",
      value: "2025-13-01",
    });
    expect(badDate.data?.valid === false, "bad daterange rejected");
    const goodDate = await callTool<{ valid: boolean }>(client, "validate_value", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-gk",
      line_number: "2",
      value: { from: "01.01.2025", to: "31.12.2025" },
    });
    expect(goodDate.data?.valid === true, "good daterange accepted");

    header("Session: write a value");
    const setField = await callTool<{ valid: boolean; filled_count: number }>(
      client,
      "session_set_field",
      {
        session_id: sessionId,
        form_slug: "anlage-gk",
        line_number: "11",
        value: "150000,00",
      }
    );
    expect(setField.data?.valid === true, "session_set_field valid");
    expect(setField.data?.filled_count === 1, "filled_count is 1");

    header("Session: status snapshot");
    const status = await callTool<{
      selected_forms: string[];
      filled_count: number;
      total_required_fields_estimate: number;
      missing_profile_fields: string[];
    }>(client, "session_get_status", { session_id: sessionId });
    console.log(`   ${summarize(status.data)}`);
    expect((status.data?.missing_profile_fields ?? []).length === 0, "no profile fields missing");

    header("Help search: 'Bilanz'");
    const helpHits = await callTool<{ matches: Array<{ help_source: string }> }>(
      client,
      "search_help",
      { tax_type: "kst", year: "2025", query: "Bilanz", limit: 3 }
    );
    console.log(`   first hit: ${helpHits.data?.matches[0]?.help_source}`);
    expect((helpHits.data?.matches.length ?? 0) > 0, "help search returns hits");

    header("Get full help section by anchor");
    const helpSection = await callTool<{ body: string }>(client, "get_help_section", {
      tax_type: "kst",
      year: "2025",
      help_source: "elster_kst2025_help.md#hinweise-zur-anlage-gk/bilanzielles-ergebnis",
      include_children: true,
    });
    expect((helpSection.data?.body.length ?? 0) > 200, "section body is substantial");

    header("Session export / re-import roundtrip");
    const exported = await callTool<{ state: unknown }>(client, "session_export", {
      session_id: sessionId,
    });
    expect(exported.ok, "export ok");
    const reimport = await callTool<{ session_id: string }>(client, "session_import", {
      state: exported.data?.state,
    });
    expect(reimport.data?.session_id === sessionId, "session_id preserved across import");

    header("Triggers: KSt Anlage Zinsschranke (no triggers in 2025 help)");
    const ztrig = await callTool<{ triggers: unknown[] }>(client, "get_form_triggers", {
      tax_type: "kst",
      year: "2025",
      form_slug: "anlage-zinsschranke",
    });
    expect((ztrig.data?.triggers ?? []).length === 0, "anlage-zinsschranke has 0 triggers (source has none)");

    header("Degraded mode: forms work for KSt 2024, triggers/snippets do not");
    const ist2024 = await callTool<{ forms: unknown[] }>(client, "list_forms", {
      tax_type: "kst",
      year: "2024",
    });
    expect(ist2024.ok && (ist2024.data?.forms.length ?? 0) > 0, "KSt 2024 forms still loaded");
    const line2024 = await callTool<{ help_snippet: string | null }>(client, "get_line", {
      tax_type: "kst",
      year: "2024",
      form_slug: "anlage-gk",
      line_number: "11",
    });
    expect(line2024.data?.help_snippet === null, "KSt 2024 returns null snippet");
    const warnings = (line2024 as ToolEnvelope).warnings ?? [];
    expect(warnings.length > 0, "warning surfaced for missing help mapping");
  } finally {
    await client.close();
    await transport.close();
  }

  console.log(`\n# Result`);
  if (failures.length === 0) {
    console.log(`${stepCount} steps, all assertions passed.`);
    process.exit(0);
  } else {
    console.log(`${stepCount} steps, ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
