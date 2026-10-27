/** @see specs/auth/azure-ad-account-upgrade.feature */
import { describe, expect, it } from "vitest";

import { readMicrosoftAccountKeyMove } from "../microsoft-account-key-move.rules.ts";

const ISSUER = "https://login.microsoftonline.com/3f2504e0-4f89-11d3-9a0c-0305e82c3301/v2.0";
const token = { sub: "pairwise-sub", oid: "object-id", iss: ISSUER };

describe("readMicrosoftAccountKeyMove", () => {
  describe("when the id token carries sub, oid and iss", () => {
    /** @scenario "A Microsoft id token names the key move from sub to iss and oid" */
    it("moves the sub-keyed account onto the issuer and the oid", () => {
      expect(readMicrosoftAccountKeyMove(token)).toEqual({
        kind: "move",
        legacySubject: "pairwise-sub",
        issuer: ISSUER,
        accountId: "object-id",
      });
    });
  });

  describe("when a claim is missing or unusable", () => {
    /** @scenario "A Microsoft id token names the key move from sub to iss and oid" */
    it.each([
      ["sub", { ...token, sub: undefined }],
      ["oid", { ...token, oid: "" }],
      ["iss", { ...token, iss: undefined }],
      ["a non-https iss", { ...token, iss: "local:oauth:microsoft" }],
      ["a sub distinct from the oid", { ...token, sub: "same", oid: "same" }],
    ])("asks for no move without %s", (_label, profile) => {
      expect(readMicrosoftAccountKeyMove(profile)).toEqual({ kind: "none" });
    });
  });
});
