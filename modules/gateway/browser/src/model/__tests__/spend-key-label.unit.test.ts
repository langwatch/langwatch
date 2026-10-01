/**
 * @see ../spend-key-label.ts
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it } from "vitest";

import { spendKeyLabel } from "../spend-key-label";

describe("given a spend row of request type instant_eval with no virtual key", () => {
  describe("when the spend page names its key", () => {
    /** @scenario "A spend row with no virtual key and the instant eval request type reads as Instant Evals" */
    it("says Instant Evals", () => {
      expect(
        spendKeyLabel({
          row: { virtualKeyId: "", requestType: "instant_eval" },
          virtualKeyName: undefined,
        }),
      ).toBe("Instant Evals");
    });
  });
});

describe("given a gateway request row", () => {
  describe("when the spend page names its key", () => {
    it("says the key's name, or its id when the name is unknown", () => {
      expect(
        spendKeyLabel({
          row: { virtualKeyId: "vk_1", requestType: "chat" },
          virtualKeyName: "prod key",
        }),
      ).toBe("prod key");
      expect(
        spendKeyLabel({
          row: { virtualKeyId: "vk_1", requestType: "chat" },
          virtualKeyName: undefined,
        }),
      ).toBe("vk_1");
    });
  });
});
