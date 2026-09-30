/**
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn((text: string) => `mock-iv:mock-encrypted-${text}:mock-tag`),
  decrypt: vi.fn((encrypted: string) => {
    const match = encrypted.match(/^mock-iv:mock-encrypted-(.+):mock-tag$/);
    if (!match) throw new Error("Invalid encrypted string format");
    return match[1]!;
  }),
}));

import { encrypt } from "~/utils/encryption";
import { checkupModelProviderRow } from "../modelProviderRows";

describe("checkupModelProviderRow", () => {
  describe("given an OpenAI provider whose key is stored encrypted", () => {
    describe("when the checkup reads the row", () => {
      /** @scenario "The model provider test reads the provider's stored key" */
      it("hands the provider test the decrypted key", () => {
        const row = checkupModelProviderRow({
          id: "mp_1",
          provider: "openai",
          customKeys: encrypt(JSON.stringify({ OPENAI_API_KEY: "sk-real" })),
        });

        expect(row).toEqual({
          id: "mp_1",
          provider: "openai",
          customKeys: { OPENAI_API_KEY: "sk-real" },
          hasUnreadableKeys: false,
        });
      });
    });
  });

  describe("given a row whose keys will not decrypt", () => {
    describe("when the checkup reads the row", () => {
      it("holds no keys and flags them unreadable", () => {
        const row = checkupModelProviderRow({
          id: "mp_2",
          provider: "openai",
          customKeys: "not-an-encrypted-value",
        });

        expect(row.customKeys).toEqual({});
        expect(row.hasUnreadableKeys).toBe(true);
      });
    });
  });

  describe("given a row with no stored keys", () => {
    describe("when the checkup reads the row", () => {
      it("does not flag the keys unreadable", () => {
        const row = checkupModelProviderRow({
          id: "mp_3",
          provider: "openai",
          customKeys: null,
        });

        expect(row.hasUnreadableKeys).toBe(false);
      });
    });
  });
});
