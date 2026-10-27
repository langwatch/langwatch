import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  CODEX_OAUTH_ISSUER,
  codexTokenKeysSchema,
  customModelEntrySchema,
  isLegacyCustomModels,
  modelProviderWriteInputSchema,
  modelProviderScopeSchema,
  translateInputSchema,
} from "../index.ts";

describe("Model Provider contract", () => {
  it("requires an explicit tenant anchor", () => {
    expect(() =>
      modelProviderWriteInputSchema.parse({ provider: "openai", enabled: true }),
    ).toThrow(ZodError);
    expect(
      modelProviderWriteInputSchema.parse({
        projectId: "project_1",
        provider: "openai",
        enabled: true,
      }).projectId,
    ).toBe("project_1");
  });

  it("keeps scopes portable and strict", () => {
    expect(modelProviderScopeSchema.validate({ scopeType: "PROJECT", scopeId: "p1" })).toBe(true);
    expect(
      modelProviderScopeSchema.validate({
        scopeType: "PROJECT",
        scopeId: "p1",
        prisma: true,
      }),
    ).toBe(false);
  });

  it("bounds translation input at the contract boundary", () => {
    expect(translateInputSchema.validate({ projectId: "p1", text: "hello" })).toBe(true);
    expect(translateInputSchema.validate({ projectId: "p1", text: "x".repeat(100_001) })).toBe(
      false,
    );
  });

  it("owns the custom-model and Codex credential schemas", () => {
    expect(
      customModelEntrySchema.validate({
        modelId: "my-model",
        displayName: "My model",
        mode: "chat",
      }),
    ).toBe(true);
    expect(
      customModelEntrySchema.validate({
        modelId: "my-model",
        displayName: "My model",
        mode: "chat",
        privateField: true,
      }),
    ).toBe(false);
    expect(
      codexTokenKeysSchema.validate({
        CODEX_ACCESS_TOKEN: "access",
        CODEX_REFRESH_TOKEN: "refresh",
        CODEX_ID_TOKEN: "id",
        CODEX_ACCOUNT_ID: "account",
        CODEX_PLAN: "plus",
        CODEX_EMAIL: "user@example.com",
        CODEX_TOKENS_SAVED_AT: new Date().toISOString(),
      }),
    ).toBe(true);
    expect(CODEX_OAUTH_ISSUER).toBe("https://auth.openai.com");
    expect(isLegacyCustomModels(["my-model"])).toBe(true);
  });
});
