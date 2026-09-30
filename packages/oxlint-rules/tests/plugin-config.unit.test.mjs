import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { rules } from "../src/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CONFIGS = ["packages/architecture-enforcer/oxlint.architecture.jsonc", ".oxlintrc.jsonc"];
const COMMENT_OR_STRING = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const TRAILING_COMMA = /,(\s*[}\]])/g;

/** JSONC to a value: comments dropped outside strings, trailing commas removed. */
function readJsonc(path) {
  const text = readFileSync(join(root, path), "utf8");
  const json = text
    .replace(COMMENT_OR_STRING, (token) => (token.startsWith('"') ? token : ""))
    .replace(TRAILING_COMMA, "$1");

  return JSON.parse(json);
}

/** Every `[config, ruleId, setting]` either config declares, top level and overrides alike. */
function declaredRules() {
  return CONFIGS.flatMap((path) => {
    const config = readJsonc(path);
    const blocks = [
      config.rules ?? {},
      ...(config.overrides ?? []).map((entry) => entry.rules ?? {}),
    ];

    return blocks.flatMap((block) =>
      Object.entries(block).map(([id, setting]) => [path, id, setting]),
    );
  });
}

function severityOf(setting) {
  return Array.isArray(setting) ? setting[0] : setting;
}

describe("given the plugin registry and the two oxlint configs", () => {
  const declared = declaredRules();

  describe("when every declared severity is read", () => {
    /** @scenario "No rule is configured at warn" */
    it("finds no warn, because lint runs with --quiet and drops it", () => {
      const warned = declared
        .filter(([, , setting]) => ["warn", 1].includes(severityOf(setting)))
        .map(([path, id]) => `${path}: ${id}`);

      expect(warned).toEqual([]);
    });
  });

  describe("when the registry is compared with the langwatch rules the configs enable", () => {
    const enabled = new Set(
      declared
        .filter(([, id, setting]) => id.startsWith("langwatch/") && severityOf(setting) === "error")
        .map(([, id]) => id.slice("langwatch/".length)),
    );

    /** @scenario "Every registered rule is enabled" */
    it("enables every registered rule at error", () => {
      expect(Object.keys(rules).filter((name) => !enabled.has(name))).toEqual([]);
    });

    /** @scenario "Every configured langwatch rule is registered" */
    it("configures no langwatch rule the registry does not hold", () => {
      const configured = declared
        .filter(([, id]) => id.startsWith("langwatch/"))
        .map(([, id]) => id.slice("langwatch/".length));

      expect(configured.filter((name) => !Object.hasOwn(rules, name))).toEqual([]);
    });

    /** @scenario "The registry keys each rule by its own declared name" */
    it("keys each rule by the name its defineRule declaration carries", () => {
      for (const [name, rule] of Object.entries(rules)) expect(rule.meta.docs.name).toBe(name);
    });
  });

  describe("when the native rule that owns should-titles is read", () => {
    /** @scenario "A should-prefixed test title is refused by vitest/valid-title" */
    it("refuses a leading should on it and test titles", () => {
      const [, , setting] = declared.find(([, id]) => id === "vitest/valid-title");

      expect(severityOf(setting)).toBe("error");
      expect(setting[1].mustNotMatch).toEqual({ it: "(?i)^should\\b", test: "(?i)^should\\b" });
    });
  });
});
