import { describe, expect, it } from "vitest";
import {
  MAX_SECRET_VALUE_LENGTH,
  secretNameSchema,
  secretPublicSchema,
  secretValueSchema,
} from "../src";

describe("Secret contract", () => {
  it("accepts upper-snake-case names only", () => {
    expect(secretNameSchema.parse("OPENAI_API_KEY")).toBe("OPENAI_API_KEY");
    expect(secretNameSchema.safeParse("openai-key").success).toBe(false);
  });

  it("enforces the value ceiling", () => {
    expect(secretValueSchema.safeParse("x".repeat(MAX_SECRET_VALUE_LENGTH)).success).toBe(
      true,
    );
    expect(
      secretValueSchema.safeParse("x".repeat(MAX_SECRET_VALUE_LENGTH + 1)).success,
    ).toBe(false);
  });

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
});
