/**
 * Which board a template already made, so its library card shows it as added.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_TEMPLATES } from "../catalogue/index.ts";
import { boardFromTemplateId } from "../model/boards.ts";

const TEMPLATE = "Running costs";

describe("boardFromTemplateId", () => {
  /** @scenario "AC145 Template card: a template already added shows Added, linking to its board" */
  it("finds the board named after the template, or numbered from 2 as a second copy is", () => {
    expect(
      boardFromTemplateId({ templateNames: [TEMPLATE], boards: [{ id: "a", name: TEMPLATE }] }),
    ).toBe("a");
    expect(
      boardFromTemplateId({
        templateNames: [TEMPLATE],
        boards: [{ id: "b", name: `${TEMPLATE} 12` }],
      }),
    ).toBe("b");
  });

  /** @scenario "AC145 Template card: a template already added shows Added, linking to its board" */
  it.each([
    ["a renamed board", "Our spend"],
    ["a longer name", `${TEMPLATE} for finance`],
    ["number 1", `${TEMPLATE} 1`],
    ["a padded number", `${TEMPLATE} 02`],
    ["a fraction", `${TEMPLATE} 2.5`],
  ])("matches no board for %s", (_case, name) => {
    expect(boardFromTemplateId({ templateNames: [TEMPLATE], boards: [{ id: "x", name }] })).toBe(
      undefined,
    );
  });

  /** @scenario "AC145b Template card: a board made under a template's former name still counts as added" */
  it("finds a board made under the template's former name", () => {
    const glance = CATALOGUE_TEMPLATES.find(({ id }) => id === "cockpit")!;
    expect(glance.name).toBe("My agent at a glance");
    expect(
      boardFromTemplateId({
        templateNames: [glance.name, ...glance.formerNames],
        boards: [{ id: "old", name: "Agent health 2" }],
      }),
    ).toBe("old");
  });
});
