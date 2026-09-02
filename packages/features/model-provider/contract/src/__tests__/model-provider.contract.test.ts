import { describe, expect, it } from "vitest";
import {
  CODEX_OAUTH_ISSUER,
  codexTokenKeysSchema,
  customModelEntrySchema,
  isLegacyCustomModels,
  modelProviderWriteInputSchema,
  modelProviderScopeSchema,
  translateInputSchema,
} from "../index";

describe("Model Provider contract", () => {
  it("requires an explicit tenant anchor", () => {
    expect(() =>
      modelProviderWriteInputSchema.parse({ provider: "openai", enabled: true }),
    ).toThrow();
    expect(
      modelProviderWriteInputSchema.parse({
        projectId: "project_1",
        provider: "openai",
        enabled: true,
      }).projectId,
    ).toBe("project_1");
  });

  it("keeps scopes portable and strict", () => {
    expect(
      modelProviderScopeSchema.safeParse({ scopeType: "PROJECT", scopeId: "p1" }).success,
    ).toBe(true);
    expect(
      modelProviderScopeSchema.safeParse({
        scopeType: "PROJECT",
        scopeId: "p1",
        prisma: true,
      }).success,
    ).toBe(false);
  });

  it("bounds translation input at the contract boundary", () => {
    expect(translateInputSchema.safeParse({ projectId: "p1", text: "hello" }).success).toBe(true);
    expect(
      translateInputSchema.safeParse({ projectId: "p1", text: "x".repeat(100_001) }).success,
    ).toBe(false);
  });

  it("owns the custom-model and Codex credential schemas", () => {
    expect(
      customModelEntrySchema.safeParse({
        modelId: "my-model",
        displayName: "My model",
        mode: "chat",
      }).success,
    ).toBe(true);
    expect(
      customModelEntrySchema.safeParse({
        modelId: "my-model",
        displayName: "My model",
        mode: "chat",
        privateField: true,
      }).success,
    ).toBe(false);
    expect(
      codexTokenKeysSchema.safeParse({
        CODEX_ACCESS_TOKEN: "access",
        CODEX_REFRESH_TOKEN: "refresh",
        CODEX_ID_TOKEN: "id",
        CODEX_ACCOUNT_ID: "account",
        CODEX_PLAN: "plus",
        CODEX_EMAIL: "user@example.com",
        CODEX_TOKENS_SAVED_AT: new Date().toISOString(),
      }).success,
    ).toBe(true);
    expect(CODEX_OAUTH_ISSUER).toBe("https://auth.openai.com");
    expect(isLegacyCustomModels(["my-model"])).toBe(true);
  });
});
