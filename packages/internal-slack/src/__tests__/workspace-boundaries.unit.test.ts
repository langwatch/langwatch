import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PACKAGE = "@langwatch/internal-slack";
const AUTOMATION = "modules/automation";
const COMMENT_OR_STRING = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const TRAILING_COMMA = /,(\s*[}\]])/g;

type Override = { files?: string[]; rules?: Record<string, unknown> };

const restrictsThisPackage = (setting: unknown): boolean =>
  Array.isArray(setting) &&
  setting.some(
    (option: unknown) =>
      typeof option === "object" &&
      option !== null &&
      "paths" in option &&
      Array.isArray(option.paths) &&
      option.paths.some(
        (path: unknown) =>
          typeof path === "object" && path !== null && "name" in path && path.name === PACKAGE,
      ),
  );

/** Source files and manifests, walked without descending into installs or builds. */
function sourcesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", "dist"].includes(entry.name) ? [] : sourcesUnder(path);
    }
    return /\.(ts|tsx|json)$/.test(entry.name) ? [path] : [];
  });
}

function lintOverrides(): Override[] {
  const text = readFileSync(join(repoRoot, ".oxlintrc.native.jsonc"), "utf8")
    .replace(COMMENT_OR_STRING, (token) => (token.startsWith('"') ? token : ""))
    .replace(TRAILING_COMMA, "$1");
  const config: { overrides?: Override[] } = JSON.parse(text);
  return config.overrides ?? [];
}

describe("given customer Slack lives in automation's channels", () => {
  /** @scenario "Customer Slack never uses the internal notice templates" */
  it("refuses the internal package in every lint override that covers automation", () => {
    const covering = lintOverrides().filter(
      (entry) =>
        entry.files?.some((glob) => glob.startsWith(AUTOMATION)) &&
        entry.rules?.["no-restricted-imports"] !== undefined,
    );

    expect(covering.length).toBeGreaterThan(0);
    for (const entry of covering) {
      expect(restrictsThisPackage(entry.rules?.["no-restricted-imports"])).toBe(true);
    }
  });

  it("finds no automation file or manifest that reaches for the internal package", () => {
    const offences = sourcesUnder(join(repoRoot, AUTOMATION)).filter((file) =>
      readFileSync(file, "utf8").includes(PACKAGE),
    );

    expect(offences).toEqual([]);
  });
});
