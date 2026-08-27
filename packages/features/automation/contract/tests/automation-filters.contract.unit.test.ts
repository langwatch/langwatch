import { describe, expect, it } from "vitest";
import { parseAutomationFiltersWire } from "../src/automation-filters";
import { parseTriggerTemplatesWire } from "../src/trigger";

describe("parseAutomationFiltersWire", () => {
  it.each([{ "spans.model": ["gpt-5-mini"] }, JSON.stringify({ "spans.model": ["gpt-5-mini"] })])(
    "preserves supported filters from canonical and legacy values",
    (value) => {
      expect(parseAutomationFiltersWire(value)).toEqual({
        "spans.model": ["gpt-5-mini"],
      });
    },
  );

  it("drops unknown fields without discarding supported fields", () => {
    expect(
      parseAutomationFiltersWire({
        "spans.model": ["gpt-5-mini"],
        "retired.field": ["old"],
      }),
    ).toEqual({ "spans.model": ["gpt-5-mini"] });
  });

  it.each(["{", [], null])("returns an empty filter set for malformed input", (value) => {
    expect(parseAutomationFiltersWire(value)).toEqual({});
  });
});

describe("parseTriggerTemplatesWire", () => {
  const templates = {
    slackTemplateType: "string",
    slackTemplate: "hello",
    emailSubjectTemplate: "subject",
    emailBodyTemplate: "body",
  };

  it.each([templates, { templates }])(
    "preserves templates from legacy and canonical trigger reads",
    (value) => {
      expect(parseTriggerTemplatesWire(value)).toEqual(templates);
    },
  );
});
