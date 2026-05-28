/**
 * Unit tests for scope-filter.feature — grep-verifiable import invariants.
 *
 * These tests verify the structural correctness mandated by the spec without
 * rendering any React components: shared paths, no parallel implementations.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const LANGWATCH_ROOT = path.resolve(__dirname, "../../../../../");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(LANGWATCH_ROOT, rel), "utf8");
}

describe("given the scope-filter feature is implemented", () => {
  describe("when checking that ScopeFilter is shared between pages", () => {
    it("api-keys/ApiKeysSection imports ScopeFilter from the shared settings component", () => {
      // ApiKeysSection is the component that renders the table; it must import ScopeFilter
      const apiKeysSection = readFile(
        "src/pages/settings/api-keys/ApiKeysSection.tsx",
      );
      // Accept both tilde alias and relative path forms — what matters is the
      // component file name, not the import style.
      const importsScopeFilter =
        apiKeysSection.includes("~/components/settings/ScopeFilter") ||
        apiKeysSection.includes("components/settings/ScopeFilter");
      expect(importsScopeFilter).toBe(true);
    });

    it("model-providers also imports ScopeFilter from the shared settings component", () => {
      const modelProviders = readFile("src/pages/settings/model-providers.tsx");
      const importsScopeFilter =
        modelProviders.includes("~/components/settings/ScopeFilter") ||
        modelProviders.includes("components/settings/ScopeFilter");
      expect(importsScopeFilter).toBe(true);
    });

    it("no second scope-filter component file exists alongside ScopeFilter.tsx", () => {
      const settingsDir = path.join(LANGWATCH_ROOT, "src/components/settings");
      const files = fs.readdirSync(settingsDir);
      const scopeFilterFiles = files.filter(
        (f) =>
          f.toLowerCase().includes("scopefilter") &&
          f !== "ScopeFilter.tsx",
      );
      expect(scopeFilterFiles).toHaveLength(0);
    });
  });

  describe("when checking that filterProvidersByScope is used directly — no wrapper", () => {
    it("ApiKeysSection calls filterProvidersByScope from utils/filterProvidersByScope", () => {
      const apiKeysSection = readFile(
        "src/pages/settings/api-keys/ApiKeysSection.tsx",
      );
      expect(apiKeysSection).toContain("filterProvidersByScope");
    });

    it("no filterKeysByScope wrapper file exists", () => {
      const utilsDir = path.join(LANGWATCH_ROOT, "src/utils");
      const filterFilePath = path.join(utilsDir, "filterKeysByScope.ts");
      expect(fs.existsSync(filterFilePath)).toBe(false);
    });

    it("no filterKeysByScope function is defined anywhere in api-keys pages", () => {
      const apiKeysDir = path.join(
        LANGWATCH_ROOT,
        "src/pages/settings/api-keys",
      );
      const allFiles = fs
        .readdirSync(apiKeysDir)
        .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
        .map((f) => fs.readFileSync(path.join(apiKeysDir, f), "utf8"));
      const combined = allFiles.join("\n");
      expect(combined).not.toContain("filterKeysByScope");
    });
  });

  describe("when checking that useAvailableScopes is shared", () => {
    it("ApiKeysSection imports useAvailableScopes from the shared hook", () => {
      const apiKeysSection = readFile(
        "src/pages/settings/api-keys/ApiKeysSection.tsx",
      );
      expect(apiKeysSection).toContain("useAvailableScopes");
    });

    it("model-providers imports useAvailableScopes from the shared hook", () => {
      const modelProviders = readFile("src/pages/settings/model-providers.tsx");
      expect(modelProviders).toContain("useAvailableScopes");
    });

    it("model-providers calls useAvailableScopes rather than inline derivation", () => {
      const modelProviders = readFile("src/pages/settings/model-providers.tsx");
      // The shared hook call must be present
      expect(modelProviders).toContain("useAvailableScopes(");
      // The page must NOT re-implement the derivation inline as a standalone
      // useMemo that builds teams: teams.map(...), projects: teams.flatMap(...)
      // (i.e. the hook's own body pattern must not appear in the page file)
      expect(modelProviders).not.toContain("teams.flatMap((t) =>");
    });
  });
});
