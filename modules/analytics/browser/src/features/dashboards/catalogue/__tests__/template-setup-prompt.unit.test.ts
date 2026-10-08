/**
 * A template's Langy prompt ends by asking Langy to find what the board needs that the
 * project has not set up yet, and to offer help setting each piece up.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_TEMPLATES, CATALOGUE_WIDGETS, templateSetupNeeds } from "../index.ts";

describe("given every template's report prompt", () => {
  /** @scenario "Template prompt: Langy also checks what the template needs that is not set up yet" */
  it("asks Langy to check what is not set up yet, naming the template's needs, and offer help", () => {
    for (const { id, reportPrompt, widgets } of CATALOGUE_TEMPLATES) {
      expect(reportPrompt, id).toContain("needs that my project has not set up yet");
      expect(reportPrompt, id).toContain("such as cost, user id or evaluator results");
      expect(reportPrompt, id).toContain("integrations I have not connected");
      expect(reportPrompt, id).toContain("offer to help me set up each piece");
      for (const need of templateSetupNeeds(widgets)) expect(reportPrompt, id).toContain(need);
    }
    expect(CATALOGUE_TEMPLATES.some(({ widgets }) => templateSetupNeeds(widgets).length > 0)).toBe(
      true,
    );
  });

  /** @scenario "Template prompt: Langy also checks what the template needs that is not set up yet" */
  it("names nothing for a widget plain traces answer", () => {
    const tracesOnly = CATALOGUE_WIDGETS.find(({ requirements }) =>
      requirements.every((alternatives) => alternatives.includes("traces")),
    )!;

    expect(templateSetupNeeds([tracesOnly.id])).toEqual([]);
  });
});
