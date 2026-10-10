import { describe, expect, it } from "vitest";

import {
  MAX_SECRET_VALUE_LENGTH,
  referencedSecretNames,
  secretNameSchema,
  secretPublicSchema,
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

  it("finds each secret reference once, including one written across a line break", () => {
    expect(
      referencedSecretNames({
        headers: [{ value: "Bearer {{ secrets.API_TOKEN }}" }],
        body: "{{\n  secrets.OTHER }} and {{secrets.API_TOKEN}}",
      }),
    ).toEqual(["API_TOKEN", "OTHER"]);
  });
});
