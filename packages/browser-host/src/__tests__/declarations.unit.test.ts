import { uiTokens } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { NO_UI_DECLARATIONS, uiDeclarations } from "../declarations.ts";

const Card = uiTokens("organization").extension<{ organizationId: string }>("overviewCard");
const Other = uiTokens("organization").extension<{ organizationId: string }>("otherCard");

const load = () => Promise.resolve({ default: () => null });

describe("uiDeclarations", () => {
  describe("given two installed modules that both lend an overview card", () => {
    /** @scenario "Declarations are read in install order" */
    it("answers both in install order, each naming its module", () => {
      const declarations = uiDeclarations([
        { name: "scim", installation: { capabilities: {}, lends: [{ token: Card, load }] } },
        { name: "sso", installation: { capabilities: {}, lends: [{ token: Card, load }] } },
      ]);

      expect(declarations.lent(Card).map((entry) => entry.module)).toEqual(["scim", "sso"]);
    });
  });

  describe("given a module whose lends name other tokens only", () => {
    /** @scenario "A module that declared nothing under the name is skipped" */
    it("contributes nothing under the token it did not lend", () => {
      const declarations = uiDeclarations([
        { name: "auth", installation: { capabilities: {}, lends: [{ token: Other, load }] } },
        { name: "billing", installation: { capabilities: {} } },
      ]);

      expect(declarations.lent(Card)).toEqual([]);
    });
  });

  describe("given no declarations were installed", () => {
    /** @scenario "A screen mounted with no shell reads nothing declared" */
    it("reads an empty list", () => {
      expect(NO_UI_DECLARATIONS.lent(Card)).toEqual([]);
    });
  });
});
