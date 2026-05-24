/**
 * Regression test for issue #3903 friction #2: gateway secret keys in
 * .env.example are empty and lack a nearby generation command.
 *
 * A developer doing a fresh clone who follows the .env.example verbatim
 * will end up with empty secrets, causing 503 errors at the first VK
 * request. The fix is twofold:
 *   1. Each key must carry a non-empty sentinel placeholder.
 *   2. The generation command (`openssl rand -hex 32`) must appear in the
 *      5 lines immediately above each key so it's impossible to miss.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Resolve .env.example relative to this test file's location:
// src/__tests__/ -> ../../ -> langwatch/ -> .env.example
const ENV_EXAMPLE_PATH = path.join(__dirname, "../../.env.example");

const envExampleLines: string[] = readFileSync(ENV_EXAMPLE_PATH, "utf-8").split(
  "\n",
);

/**
 * Returns the value part (RHS) for the first line matching `^KEY=(.*)$`.
 * Returns null if the key is not found.
 */
function getSentinelValue(key: string): string | null {
  const prefix = `${key}=`;
  const line = envExampleLines.find((l) => l.startsWith(prefix));
  if (line === undefined) return null;
  return line.slice(prefix.length).trim();
}

/**
 * Returns the 5 lines immediately preceding the first line matching
 * `^KEY=...`. Returns an empty array if the key is not found or is at the
 * top of the file.
 */
function getPrecedingLines(key: string, windowSize = 5): string[] {
  const prefix = `${key}=`;
  const idx = envExampleLines.findIndex((l) => l.startsWith(prefix));
  if (idx < 0) return [];
  const start = Math.max(0, idx - windowSize);
  return envExampleLines.slice(start, idx);
}

describe("langwatch/.env.example", () => {
  describe("when the gateway-secret declarations are inspected", () => {
    /** @scenario .env.example ships a sentinel placeholder for LW_VIRTUAL_KEY_PEPPER */
    it("declares a non-empty sentinel value for LW_VIRTUAL_KEY_PEPPER", () => {
      const value = getSentinelValue("LW_VIRTUAL_KEY_PEPPER");
      expect(value, "LW_VIRTUAL_KEY_PEPPER must have a sentinel value").not.toBeNull();
      expect(
        value!.length,
        "LW_VIRTUAL_KEY_PEPPER sentinel must be non-empty",
      ).toBeGreaterThan(0);
    });

    /** @scenario .env.example ships a sentinel placeholder for LW_GATEWAY_INTERNAL_SECRET */
    it("declares a non-empty sentinel value for LW_GATEWAY_INTERNAL_SECRET", () => {
      const value = getSentinelValue("LW_GATEWAY_INTERNAL_SECRET");
      expect(value, "LW_GATEWAY_INTERNAL_SECRET must have a sentinel value").not.toBeNull();
      expect(
        value!.length,
        "LW_GATEWAY_INTERNAL_SECRET sentinel must be non-empty",
      ).toBeGreaterThan(0);
    });

    /** @scenario .env.example ships a sentinel placeholder for LW_GATEWAY_JWT_SECRET */
    it("declares a non-empty sentinel value for LW_GATEWAY_JWT_SECRET", () => {
      const value = getSentinelValue("LW_GATEWAY_JWT_SECRET");
      expect(value, "LW_GATEWAY_JWT_SECRET must have a sentinel value").not.toBeNull();
      expect(
        value!.length,
        "LW_GATEWAY_JWT_SECRET sentinel must be non-empty",
      ).toBeGreaterThan(0);
    });

    it("preceding comment for LW_VIRTUAL_KEY_PEPPER mentions openssl rand -hex 32", () => {
      const preceding = getPrecedingLines("LW_VIRTUAL_KEY_PEPPER");
      const mentionsCommand = preceding.some((l) =>
        l.includes("openssl rand -hex 32"),
      );
      expect(
        mentionsCommand,
        `One of the 5 lines above LW_VIRTUAL_KEY_PEPPER must contain "openssl rand -hex 32". Got:\n${preceding.join("\n")}`,
      ).toBe(true);
    });

    it("preceding comment for LW_GATEWAY_INTERNAL_SECRET mentions openssl rand -hex 32", () => {
      const preceding = getPrecedingLines("LW_GATEWAY_INTERNAL_SECRET");
      const mentionsCommand = preceding.some((l) =>
        l.includes("openssl rand -hex 32"),
      );
      expect(
        mentionsCommand,
        `One of the 5 lines above LW_GATEWAY_INTERNAL_SECRET must contain "openssl rand -hex 32". Got:\n${preceding.join("\n")}`,
      ).toBe(true);
    });

    it("preceding comment for LW_GATEWAY_JWT_SECRET mentions openssl rand -hex 32", () => {
      const preceding = getPrecedingLines("LW_GATEWAY_JWT_SECRET");
      const mentionsCommand = preceding.some((l) =>
        l.includes("openssl rand -hex 32"),
      );
      expect(
        mentionsCommand,
        `One of the 5 lines above LW_GATEWAY_JWT_SECRET must contain "openssl rand -hex 32". Got:\n${preceding.join("\n")}`,
      ).toBe(true);
    });
  });
});
