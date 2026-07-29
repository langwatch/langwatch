import { describe, expect, it } from "vitest";
import { dataPrivacyConfigSchema } from "../dataPrivacy.types";

describe("dataPrivacyConfigSchema", () => {
  describe("given the pii config", () => {
    describe("when the level is custom with known entities", () => {
      it("accepts the config", () => {
        const result = dataPrivacyConfigSchema.safeParse({
          pii: { level: "custom", entities: ["EMAIL_ADDRESS", "BR_CPF"] },
        });

        expect(result.success).toBe(true);
      });
    });

    describe("when the level is custom but no entity is selected", () => {
      it("rejects the config", () => {
        const result = dataPrivacyConfigSchema.safeParse({
          pii: { level: "custom", entities: [] },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when the level is custom with an unknown entity name", () => {
      it("rejects the config", () => {
        const result = dataPrivacyConfigSchema.safeParse({
          pii: { level: "custom", entities: ["NOT_A_REAL_ENTITY"] },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when the level is custom but lists the secrets marker", () => {
      it("rejects the config (secrets are a separate toggle)", () => {
        const result = dataPrivacyConfigSchema.safeParse({
          pii: { level: "custom", entities: ["SECRET"] },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when a non-custom level carries entities", () => {
      it("rejects the config", () => {
        const result = dataPrivacyConfigSchema.safeParse({
          pii: { level: "essential", entities: ["EMAIL_ADDRESS"] },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when a non-custom level carries no entities", () => {
      it("accepts the config", () => {
        const result = dataPrivacyConfigSchema.safeParse({
          pii: { level: "essential" },
        });

        expect(result.success).toBe(true);
      });
    });
  });
});
