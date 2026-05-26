import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseHelpMarkdown, findHelpNode, renderHelpBody } from "../src/catalogue/help_tree.js";
import { normalizePages, walkLines } from "../src/catalogue/normalize.js";
import {
  searchHelp,
  searchLines,
  nearestNeighbours,
  suggestForms,
} from "../src/catalogue/search.js";
import { buildTestContext } from "./helpers.js";
import type { Catalogue } from "../src/catalogue/types.js";

let catalogue: Catalogue;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const built = await buildTestContext();
  catalogue = built.catalogue;
  cleanup = built.cleanup;
});

afterAll(async () => {
  await cleanup();
});

describe("normalize", () => {
  it("translates raw row/values/context_label into the public shape", () => {
    const pages = normalizePages([
      {
        context_label: "1 - Allgemeine Angaben",
        sections: [
          {
            section_label: "Art der Steuerpflicht",
            rows: [{ row: "6", label: "Ort der Geschäftsleitung", type: "text", values: [] }],
            sections: [],
          },
        ],
      },
    ]);
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.page_number).toBe(1);
    expect(page.page_label).toBe("1 - Allgemeine Angaben");
    const line = page.sections[0]!.lines[0]!;
    expect(line.line_number).toBe("6");
    expect(line.label).toBe("Ort der Geschäftsleitung");
    expect(line.value_type).toBe("text");
    expect(line.page_label).toBe(page.page_label);
    expect(line.section_label).toBe("Art der Steuerpflicht");
  });

  it("walks every line in document order via walkLines", () => {
    const pages = normalizePages([
      {
        context_label: "Page A",
        sections: [
          {
            section_label: null,
            rows: [{ row: "1", label: "L1", type: "text", values: [] }],
            sections: [
              {
                section_label: null,
                rows: [{ row: "2", label: "L2", type: "text", values: [] }],
                sections: [],
              },
            ],
          },
        ],
      },
    ]);
    const order: string[] = [];
    walkLines(pages, (line) => order.push(line.line_number ?? "_"));
    expect(order).toEqual(["1", "2"]);
  });
});

describe("help_tree", () => {
  it("parses headings into a tree and computes path-joined anchors", () => {
    const source = [
      "## Anleitung",
      "",
      "### Hinweise zur Anlage GK",
      "",
      "#### Bilanzielles Ergebnis",
      "",
      "###### Zeile 11",
      "",
      "Body of line 11.",
      "",
      "###### Zeile 12",
      "",
      "Body of line 12.",
    ].join("\n");
    const { docRoot } = parseHelpMarkdown(source);
    const gk = findHelpNode(docRoot, "hinweise-zur-anlage-gk");
    expect(gk?.title).toBe("Hinweise zur Anlage GK");
    const z11 = findHelpNode(docRoot, "hinweise-zur-anlage-gk/bilanzielles-ergebnis/zeile-11");
    expect(z11?.title).toBe("Zeile 11");
    const body = renderHelpBody(z11!, source, { includeChildren: false });
    expect(body).toContain("Body of line 11.");
  });
});

describe("real-data sanity", () => {
  it("has KSt 2025 forms loaded with non-empty pages", () => {
    const form = catalogue.forms.get("kst/2025/anlage-gk");
    expect(form).toBeDefined();
    expect(form!.pages.length).toBeGreaterThan(0);
    let lineCount = 0;
    walkLines(form!.pages, (l) => {
      if (l.line_number != null) lineCount++;
    });
    expect(lineCount).toBeGreaterThan(50);
  });

  it("attaches triggers to KSt 2025 Hauptvordruck", () => {
    const form = catalogue.forms.get("kst/2025/00-hauptvordruck-kst-1");
    expect(form?.mandatory).toBe(true);
    expect(form?.triggers.length).toBeGreaterThan(0);
  });

  it("has a help mapping entry for anlage-gk:11", () => {
    const entry = catalogue.helpMappings.get("kst/2025/anlage-gk/11");
    expect(entry?.snippet).toContain("Bilanz");
  });
});

describe("search", () => {
  it("ranks line label matches deterministically", () => {
    const hits = searchLines(catalogue, "kst", "2025", "Geschäftsleitung", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    // Deterministic order: top hit unchanged on rerun
    const again = searchLines(catalogue, "kst", "2025", "Geschäftsleitung", { limit: 5 });
    expect(again.map((h) => `${h.form_slug}:${h.line_number}`)).toEqual(
      hits.map((h) => `${h.form_slug}:${h.line_number}`)
    );
  });

  it("returns help hits with anchors for KSt 2025", () => {
    const hits = searchHelp(catalogue, "kst", "2025", "Bilanzielles", { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.help_source).toMatch(/elster_kst2025_help\.md#/);
  });

  it("levenshtein nearest neighbours surface obvious typos", () => {
    const out = nearestNeighbours(["anlage-gk", "anlage-zve", "anlage-ot"], "anlage-zv", 3);
    expect(out).toContain("anlage-zve");
  });

  it("suggestForms recovers a Levenshtein-close slug typo", () => {
    const out = suggestForms(
      [
        { slug: "anlage-gk", name: "Anlage GK" },
        { slug: "anlage-zve", name: "Anlage ZVE" },
        { slug: "anlage-ot", name: "Anlage OT" },
      ],
      "anlage-zv",
      3
    );
    expect(out[0]).toBe("anlage-zve");
  });

  it("suggestForms recovers from the umlaut-dropped slug case (anlage-öhk → anlage-hk-zur-spartentrennung)", () => {
    const out = suggestForms(
      [
        { slug: "anlage-gk", name: "Anlage GK" },
        { slug: "anlage-hk-zur-spartentrennung", name: "Anlage ÖHK zur Spartentrennung" },
        { slug: "anlage-aev", name: "Anlage AEV" },
      ],
      "anlage-öhk",
      3
    );
    expect(out).toContain("anlage-hk-zur-spartentrennung");
    expect(out[0]).toBe("anlage-hk-zur-spartentrennung");
  });

  it("suggestForms surfaces matches by display-name substring even when the slug differs (anlage-geno-ver from 'Genossenschaften')", () => {
    const out = suggestForms(
      [
        { slug: "anlage-geno-ver", name: "Anlage Genossenschaften Vereine" },
        { slug: "anlage-gk", name: "Anlage GK" },
        { slug: "anlage-aev", name: "Anlage AEV" },
      ],
      "anlage-genossenschaften",
      3
    );
    expect(out[0]).toBe("anlage-geno-ver");
  });
});

describe("baseline filing triggers", () => {
  it("anlage-gk has a maintainer baseline trigger for commercial corporations", () => {
    const form = catalogue.forms.get("kst/2025/anlage-gk");
    const baseline = form?.triggers.find(
      (t) => t.machine_check?.key === "business_type" && t.machine_check.value === "commercial"
    );
    expect(baseline).toBeDefined();
    expect(baseline?.confidence).toBe("certain");
  });

  it("anlage-zve has a maintainer baseline trigger for commercial corporations", () => {
    const form = catalogue.forms.get("kst/2025/anlage-zve");
    const baseline = form?.triggers.find(
      (t) => t.machine_check?.key === "business_type" && t.machine_check.value === "commercial"
    );
    expect(baseline).toBeDefined();
    expect(baseline?.confidence).toBe("certain");
  });
});
