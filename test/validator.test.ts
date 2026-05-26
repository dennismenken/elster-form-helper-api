import { describe, expect, it } from "vitest";

import type { Line } from "../src/catalogue/types.js";
import { validateValue } from "../src/validator/index.js";

function line(overrides: Partial<Line>): Line {
  return {
    line_number: "1",
    label: "x",
    value_type: "text",
    allowed_values: [],
    page_number: 1,
    page_label: "p",
    section_label: null,
    ...overrides,
  };
}

describe("validateValue", () => {
  it("accepts any string for text", () => {
    expect(validateValue(line({ value_type: "text" }), "abc").valid).toBe(true);
    expect(validateValue(line({ value_type: "text" }), 42).valid).toBe(false);
  });

  it("enforces allowed_values on select", () => {
    const l = line({ value_type: "select", allowed_values: ["A", "B"] });
    expect(validateValue(l, "A").valid).toBe(true);
    expect(validateValue(l, "C").valid).toBe(false);
  });

  it("normalizes boolean strings for checkbox", () => {
    const l = line({ value_type: "checkbox" });
    const r = validateValue(l, "true");
    expect(r.valid).toBe(true);
    expect(r.valid && r.normalized_value).toBe(true);
  });

  it("requires DD.MM.YYYY for date", () => {
    const l = line({ value_type: "date" });
    expect(validateValue(l, "31.12.2024").valid).toBe(true);
    expect(validateValue(l, "31-12-2024").valid).toBe(false);
    expect(validateValue(l, "31.13.2024").valid).toBe(false);
    expect(validateValue(l, "29.02.2024").valid).toBe(true);
    expect(validateValue(l, "29.02.2023").valid).toBe(false);
  });

  it("accepts daterange string and object", () => {
    const l = line({ value_type: "daterange" });
    const a = validateValue(l, "01.01.2025 - 31.12.2025");
    expect(a.valid).toBe(true);
    expect(a.valid && (a.normalized_value as { from: string }).from).toBe("01.01.2025");
    const b = validateValue(l, { from: "01.01.2025", to: "31.12.2025" });
    expect(b.valid).toBe(true);
    const c = validateValue(l, "31.12.2025 - 01.01.2025");
    expect(c.valid).toBe(false);
  });

  it("rejects note and repeater lines", () => {
    expect(validateValue(line({ value_type: "note", line_number: null }), "x").valid).toBe(false);
    expect(validateValue(line({ value_type: "repeater" }), "x").valid).toBe(false);
  });
});
