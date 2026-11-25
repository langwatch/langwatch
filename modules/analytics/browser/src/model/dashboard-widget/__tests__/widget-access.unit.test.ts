/**
 * The no-access state's words: what is withheld and who to ask, from the gates the server says
 * the reader lacks.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { describe, expect, it } from "vitest";

import { withheldWords } from "../widget-access.ts";

describe("withheldWords", () => {
  describe("given the reader lacks cost:view in Checkout Agent", () => {
    /** @scenario "The no access state says what is withheld and who to ask" */
    it("says cost figures are hidden and names the project's admins", () => {
      expect(withheldWords({ missingGates: ["cost:view"], projectName: "Checkout Agent" })).toEqual(
        {
          what: "Cost figures are hidden for your role",
          ask: "Ask an admin of Checkout Agent if you need to see them.",
        },
      );
    });
  });

  describe("given the reader lacks anything else", () => {
    /** @scenario "The no access state says what is withheld and who to ask" */
    it.each([
      ["captured content", ["output"]],
      ["cost and something else", ["cost:view", "input"]],
      ["no named gate", []],
    ])("says the data is hidden for %s", (_case, missingGates) => {
      expect(withheldWords({ missingGates, projectName: "Checkout Agent" })).toEqual({
        what: "This data is hidden for your role",
        ask: "Ask an admin of Checkout Agent if you need to see it.",
      });
    });
  });

  describe("given the project has not resolved", () => {
    it("says the project", () => {
      expect(withheldWords({ missingGates: ["cost:view"], projectName: undefined }).ask).toBe(
        "Ask an admin of the project if you need to see them.",
      );
    });
  });
});
