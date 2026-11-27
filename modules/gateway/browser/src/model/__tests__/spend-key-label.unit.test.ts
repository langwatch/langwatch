/**
 * @see ../spend-key-label.ts
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
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

describe("given a spend row of request type instant_eval_decision_model with no virtual key", () => {
  describe("when the spend page names its key", () => {
    /** @scenario "A spend row with no virtual key and the own decision model request type reads as Instant Evals on your own model" */
    it("says Instant Evals (own model)", () => {
      expect(
        spendKeyLabel({
          row: { virtualKeyId: "", requestType: "instant_eval_decision_model" },
          virtualKeyName: undefined,
        }),
      ).toBe("Instant Evals (own model)");
    });
  });
});

describe("given a spend row of request type pii_redaction with no virtual key", () => {
  describe("when the spend page names its key", () => {
    /** @scenario "A spend row with no virtual key and the pii redaction request type reads as PII redaction" */
    it("says PII redaction", () => {
      expect(
        spendKeyLabel({
          row: { virtualKeyId: "", requestType: "pii_redaction" },
          virtualKeyName: undefined,
        }),
      ).toBe("PII redaction");
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
