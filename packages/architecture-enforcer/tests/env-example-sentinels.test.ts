/**
 * Gateway secret keys in .env.example ship EMPTY, so a copied file never carries a known
 * secret: the gateway stays off and the process boots clean until real values are set
 * (round 17). The generation command (`openssl rand -hex 32`) sits within 5 lines above.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolve .env.example relative to this test file's location:
// packages/architecture-enforcer/tests/ -> repository root -> .env.example
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_EXAMPLE_PATH = path.join(HERE, "../../../.env.example");

const envExampleLines: string[] = readFileSync(ENV_EXAMPLE_PATH, "utf-8").split("\n");

/**
 * Returns the value part (RHS) for the first line matching `^KEY=(.*)$`.
 * Returns null if the key is not found.
 */
function isWrappedIn(raw: string, quote: string): boolean {
  return raw.startsWith(quote) && raw.endsWith(quote);
}

function getSentinelValue(key: string): string | null {
  const prefix = `${key}=`;
  const line = envExampleLines.find((l) => l.startsWith(prefix));
  if (line === undefined) return null;
  const raw = line.slice(prefix.length).trim();
  if (isWrappedIn(raw, '"') || isWrappedIn(raw, "'")) {
    return raw.slice(1, -1).trim();
  }
  return raw;
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

describe(".env.example", () => {
  describe("when the gateway-secret declarations are inspected", () => {
    /** @scenario .env.example ships an empty value for LW_VIRTUAL_KEY_PEPPER */
    it("declares an empty value for LW_VIRTUAL_KEY_PEPPER", () => {
      const value = getSentinelValue("LW_VIRTUAL_KEY_PEPPER");
      expect(value, "LW_VIRTUAL_KEY_PEPPER must be declared").not.toBeNull();
      expect(value, "LW_VIRTUAL_KEY_PEPPER must ship empty").toBe("");
    });

    /** @scenario .env.example ships an empty value for LW_GATEWAY_INTERNAL_SECRET */
    it("declares an empty value for LW_GATEWAY_INTERNAL_SECRET", () => {
      const value = getSentinelValue("LW_GATEWAY_INTERNAL_SECRET");
      expect(value, "LW_GATEWAY_INTERNAL_SECRET must be declared").not.toBeNull();
      expect(value, "LW_GATEWAY_INTERNAL_SECRET must ship empty").toBe("");
    });

    /** @scenario .env.example ships an empty value for LW_GATEWAY_JWT_SECRET */
    it("declares an empty value for LW_GATEWAY_JWT_SECRET", () => {
      const value = getSentinelValue("LW_GATEWAY_JWT_SECRET");
      expect(value, "LW_GATEWAY_JWT_SECRET must be declared").not.toBeNull();
      expect(value, "LW_GATEWAY_JWT_SECRET must ship empty").toBe("");
    });

    it("preceding comment for LW_VIRTUAL_KEY_PEPPER mentions openssl rand -hex 32", () => {
      const preceding = getPrecedingLines("LW_VIRTUAL_KEY_PEPPER");
      const mentionsCommand = preceding.some((l) => l.includes("openssl rand -hex 32"));
      expect(
        mentionsCommand,
        `One of the 5 lines above LW_VIRTUAL_KEY_PEPPER must contain "openssl rand -hex 32". Got:\n${preceding.join("\n")}`,
      ).toBe(true);
    });

    it("preceding comment for LW_GATEWAY_INTERNAL_SECRET mentions openssl rand -hex 32", () => {
      const preceding = getPrecedingLines("LW_GATEWAY_INTERNAL_SECRET");
      const mentionsCommand = preceding.some((l) => l.includes("openssl rand -hex 32"));
      expect(
        mentionsCommand,
        `One of the 5 lines above LW_GATEWAY_INTERNAL_SECRET must contain "openssl rand -hex 32". Got:\n${preceding.join("\n")}`,
      ).toBe(true);
    });

    it("preceding comment for LW_GATEWAY_JWT_SECRET mentions openssl rand -hex 32", () => {
      const preceding = getPrecedingLines("LW_GATEWAY_JWT_SECRET");
      const mentionsCommand = preceding.some((l) => l.includes("openssl rand -hex 32"));
      expect(
        mentionsCommand,
        `One of the 5 lines above LW_GATEWAY_JWT_SECRET must contain "openssl rand -hex 32". Got:\n${preceding.join("\n")}`,
      ).toBe(true);
    });
  });
});
