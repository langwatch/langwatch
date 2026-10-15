import { describe, expect, it } from "vitest";

import { ModelProviderLegacyMigrationService } from "../model-provider-legacy-migration.service.ts";

const migrations = ModelProviderLegacyMigrationService.create();

describe("ModelProviderLegacyMigrationService.planModelProviderKeysSeal", () => {
  describe("given a row with plaintext object customKeys", () => {
    describe("when migrating", () => {
      it("returns the plaintext keys for the store to seal", () => {
        const row = {
          id: "provider-1",
          projectId: "project-1",
          customKeys: { apiKey: "sk-123", orgId: "org-456" },
        };

        const result = migrations.planModelProviderKeysSeal({ row });

        expect(result).toEqual({ outcome: "seal", keys: { apiKey: "sk-123", orgId: "org-456" } });
      });
    });
  });

  describe("given a row with already-encrypted string customKeys", () => {
    describe("when migrating", () => {
      it("leaves the row unchanged", () => {
        const row = {
          id: "provider-2",
          projectId: "project-1",
          customKeys: "abc123:def456:ghi789",
        };

        const result = migrations.planModelProviderKeysSeal({ row });

        expect(result).toEqual({ outcome: "unchanged" });
      });
    });
  });

  describe("given a row with null customKeys", () => {
    describe("when migrating", () => {
      it("leaves the row unchanged", () => {
        const row = {
          id: "provider-3",
          projectId: "project-1",
          customKeys: null,
        };

        const result = migrations.planModelProviderKeysSeal({ row });

        expect(result).toEqual({ outcome: "unchanged" });
      });
    });
  });

  describe("given a row with undefined customKeys", () => {
    describe("when migrating", () => {
      it("leaves the row unchanged", () => {
        const row = {
          id: "provider-4",
          projectId: "project-1",
          customKeys: undefined,
        };

        const result = migrations.planModelProviderKeysSeal({ row });

        expect(result).toEqual({ outcome: "unchanged" });
      });
    });
  });
});
