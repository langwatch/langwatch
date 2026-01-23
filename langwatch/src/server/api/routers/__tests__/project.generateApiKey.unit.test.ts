import { describe, it, expect } from "vitest";
import { generateApiKey } from "../../../utils/apiKeyGenerator";

/**
 * Unit tests for generateApiKey function
 *
 * This file does NOT mock nanoid to test the actual API key generation.
 * Separated from main mutation tests to avoid mock conflicts.
 */

describe("generateApiKey", () => {
  it("generates keys with correct format (sk-lw-*)", () => {
    // Call the actual generateApiKey function with real nanoid
    const generatedKey = generateApiKey();

    expect(generatedKey).toMatch(/^sk-lw-/);
  });

  it("generates keys with correct length", () => {
    // Call the actual generateApiKey function with real nanoid
    const generatedKey = generateApiKey();

    expect(generatedKey.length).toBe(54); // "sk-lw-" (6) + 48 characters
  });

  it("generates unique keys on each call", () => {
    // Generate multiple keys to ensure they're different
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    const key3 = generateApiKey();

    expect(key1).not.toBe(key2);
    expect(key2).not.toBe(key3);
    expect(key1).not.toBe(key3);
  });

  it("generates keys with alphanumeric characters only", () => {
    // Generate a key and verify it contains only valid characters
    const generatedKey = generateApiKey();
    const keyPart = generatedKey.replace(/^sk-lw-/, "");

    // Should only contain 0-9, A-Z, a-z
    expect(keyPart).toMatch(/^[0-9A-Za-z]+$/);
  });
});
