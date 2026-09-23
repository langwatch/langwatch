import { describe, expect, it } from "vitest";

import {
  NO_UI_DECLARATIONS,
  uiDeclarations,
  type UiAuthenticationOverviewCardProps,
} from "../declarations.ts";

function Card(_props: UiAuthenticationOverviewCardProps) {
  return null;
}

const card = { load: () => Promise.resolve({ default: Card }) };

describe("uiDeclarations", () => {
  describe("given two installed modules that both declare an overview card", () => {
    /** @scenario "Declarations are read in install order" */
    it("answers both in install order, each naming its module", () => {
      const declarations = uiDeclarations([
        { name: "scim", installation: { capabilities: { authenticationOverviewCard: card } } },
        {
          name: "sso",
          installation: {
            capabilities: { authenticationOverviewCard: { ...card, section: "sign-in" } },
          },
        },
      ]);

      expect(
        declarations.declared("authenticationOverviewCard").map((entry) => entry.module),
      ).toEqual(["scim", "sso"]);
      expect(declarations.declared("authenticationOverviewCard")[1]?.capability.section).toBe(
        "sign-in",
      );
    });
  });

  describe("given a module whose declaration names other capabilities only", () => {
    /** @scenario "A module that declared nothing under the name is skipped" */
    it("contributes nothing under the name it did not declare", () => {
      const declarations = uiDeclarations([
        { name: "auth", installation: { capabilities: { signIn: { load: () => undefined } } } },
      ]);

      expect(declarations.declared("authenticationOverviewCard")).toEqual([]);
    });
  });

  describe("given no declarations were installed", () => {
    /** @scenario "A screen mounted with no shell reads nothing declared" */
    it("reads an empty list", () => {
      expect(NO_UI_DECLARATIONS.declared("joinOffer")).toEqual([]);
    });
  });
});
