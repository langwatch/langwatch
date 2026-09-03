import { describe, expect, it } from "vitest";

import { ModelProviderCredentialCipherPort } from "../../ports/model-provider.port";
import { migrateModelProviderKeysRow } from "../model-provider-legacy-migration.service";

/** The deployment's cipher, standing in with a readable transform. */
class RecordingCipher extends ModelProviderCredentialCipherPort {
  encrypt(value: string): string {
    return `encrypted:${value}`;
  }
  decrypt(value: string): string {
    return value.replace(/^encrypted:/, "");
  }
}

const cipher = new RecordingCipher();

describe("migrateModelProviderKeysRow", () => {
  describe("given a row with plaintext object customKeys", () => {
    describe("when migrating", () => {
      it("returns the encrypted string", () => {
        const row = {
          id: "provider-1",
          projectId: "project-1",
          customKeys: { apiKey: "sk-123", orgId: "org-456" },
        };

        const result = migrateModelProviderKeysRow({ row, cipher });

        expect(result).toBe(`encrypted:${JSON.stringify({ apiKey: "sk-123", orgId: "org-456" })}`);
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

        const result = migrateModelProviderKeysRow({ row, cipher });

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

        const result = migrateModelProviderKeysRow({ row, cipher });

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

        const result = migrateModelProviderKeysRow({ row, cipher });

        expect(result).toBeNull();
      });
    });
  });
});
