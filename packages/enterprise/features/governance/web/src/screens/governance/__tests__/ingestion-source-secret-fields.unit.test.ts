/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { buildParserConfig, isSecretFieldKey, PARSER_FIELDS } from "../governance-inventory.screen";

// Every FieldDef declared `secret: true` across every source type, flattened
// for iteration. This is the same shape `isSecretFieldKey` builds its
// SECRET_FIELD_KEYS set from - re-deriving it here (rather than importing
// the private set) keeps the test honest about walking PARSER_FIELDS itself.
const declaredSecretFields = Object.values(PARSER_FIELDS)
  .flat()
  .filter((f) => f.secret);

describe("given the ingestion-sources field definitions", () => {
  describe("when a field is declared secret: true", () => {
    it("reports every declared secret field as a secret key", () => {
      expect(declaredSecretFields.length).toBeGreaterThan(0);
      for (const field of declaredSecretFields) {
        expect(isSecretFieldKey(field.key)).toBe(true);
      }
    });
  });

  describe("when a key starts with the credentials prefix", () => {
    it("reports credentials-prefixed keys as secret even if undeclared", () => {
      expect(isSecretFieldKey("credentialsToken")).toBe(true);
      // A hypothetical future field that follows the naming convention but
      // was never explicitly marked `secret: true` - the belt-and-braces
      // fallback must still catch it.
      expect(isSecretFieldKey("credentialsPassword")).toBe(true);
    });
  });

  describe("when a key is neither declared secret nor credentials-prefixed", () => {
    it("reports the key as not secret", () => {
      expect(isSecretFieldKey("workspaceUrl")).toBe(false);
      expect(isSecretFieldKey("bucket")).toBe(false);
    });
  });
});

describe("given a composer state with both secret and non-secret values set", () => {
  // copilot_studio (rather than databricks_genie) on purpose: none of its
  // parser fields are adapter-owned (see PULL_CONFIG_OWNED_FIELDS), so a
  // non-secret field set here is expected to survive into parserConfig
  // purely on the secrecy decision under test, with nothing else filtering
  // it out first.
  const composerState = {
    sourceType: "copilot_studio" as const,
    name: "test source",
    description: "",
    parserConfig: {
      tenantId: "00000000-0000-0000-0000-000000000000",
      clientId: "00000000-0000-0000-0000-000000000001",
      clientSecret: "super-secret-client-secret-value",
    },
    ottlStatements: [],
    pullSchedule: "",
    traceProjectId: null,
  };

  describe("when building the persisted parserConfig", () => {
    it("keeps secrets out of the persisted config", () => {
      const built = buildParserConfig(composerState);
      expect(built).not.toHaveProperty("clientSecret");
      expect(Object.values(built)).not.toContain("super-secret-client-secret-value");
    });

    it("persists a non-secret field with a value", () => {
      const built = buildParserConfig(composerState);
      expect(built.tenantId).toBe("00000000-0000-0000-0000-000000000000");
    });
  });
});
