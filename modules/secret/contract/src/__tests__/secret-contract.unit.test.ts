import { describe, expect, it } from "vitest";

import {
  MAX_SECRET_VALUE_LENGTH,
  secretNameSchema,
  secretPublicSchema,
  secretTrpcCreateInputSchema,
  secretValueSchema,
} from "../index.ts";

describe("Secret contract", () => {
  it("accepts upper-snake-case names only", () => {
    expect(secretNameSchema.validate("OPENAI_API_KEY")).toBe(true);
    expect(secretNameSchema.validate("openai-key")).toBe(false);
  });

  it("enforces the value ceiling", () => {
    expect(secretValueSchema.validate("x".repeat(MAX_SECRET_VALUE_LENGTH))).toBe(true);
    expect(secretValueSchema.validate("x".repeat(MAX_SECRET_VALUE_LENGTH + 1))).toBe(false);
  });

  /** @scenario "Secret values never leave the boundary" */
  it("publishes metadata without a value field", () => {
    const parsed = secretPublicSchema.parse({
      id: "secret-1",
      projectId: "project-1",
      name: "OPENAI_API_KEY",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    });
    expect(parsed).not.toHaveProperty("value");
    expect(parsed).not.toHaveProperty("encryptedValue");
  });

  /** @scenario "A secret minted from an HTTP credential keeps the address it was saved for" */
  it("refuses an address on a create from the secrets screen", () => {
    const input = { projectId: "project-1", name: "OPENAI_API_KEY", value: "value" };

    expect(secretTrpcCreateInputSchema.validate(input)).toBe(true);
    expect(
      secretTrpcCreateInputSchema.validate({ ...input, boundOrigin: "https://agent.example.com" }),
    ).toBe(false);
  });
});
