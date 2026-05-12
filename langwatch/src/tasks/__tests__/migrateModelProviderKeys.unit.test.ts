import { describe, expect, it, vi } from "vitest";
import { migrateModelProviderKeysRow } from "../migrateModelProviderKeys";

vi.mock("../../utils/encryption", () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
}));

describe("migrateModelProviderKeysRow", () => {
  describe("given a row with plaintext object customKeys", () => {
    describe("when migrating", () => {
      it("returns the encrypted string", () => {
        const row = {
          id: "provider-1",
          projectId: "project-1",
          customKeys: { apiKey: "sk-123", orgId: "org-456" },
        };

        const result = migrateModelProviderKeysRow({ row });

        expect(result).toBe(
          `encrypted:${JSON.stringify({ apiKey: "sk-123", orgId: "org-456" })}`
        );
      });
    });
  });

  describe("given a row with already-encrypted string customKeys", () => {
    describe("when migrating", () => {
      it("returns null to indicate no migration needed", () => {
        const row = {
          id: "provider-2",
          projectId: "project-1",
          customKeys: "abc123:def456:ghi789",
        };

        const result = migrateModelProviderKeysRow({ row });

        expect(result).toBeNull();
      });
    });
  });

  describe("given a row with null customKeys", () => {
    describe("when migrating", () => {
      it("returns null to indicate no migration needed", () => {
        const row = {
          id: "provider-3",
          projectId: "project-1",
          customKeys: null,
        };

        const result = migrateModelProviderKeysRow({ row });

        expect(result).toBeNull();
      });
    });
  });

  describe("given a row with undefined customKeys", () => {
    describe("when migrating", () => {
      it("returns null to indicate no migration needed", () => {
        const row = {
          id: "provider-4",
          projectId: "project-1",
          customKeys: undefined,
        };

        const result = migrateModelProviderKeysRow({ row });

        expect(result).toBeNull();
      });
    });
  });
});
