/**
 * @vitest-environment jsdom
 *
 * Guard: the Vite `manualChunks` eager-Shiki allow-list (langwatch/vite.config.ts)
 * must stay in sync with the canonical SHIKI_BASE_LANGS / SHIKI_THEMES owned by
 * shikiAdapter.ts. If they drift, a base grammar silently drops to a lazy chunk
 * and its first highlight stalls on a network fetch. This test fails loudly if
 * a base language/theme is no longer force-kept in the eager `shiki` chunk.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { bundledLanguagesInfo } from "shiki";
import { describe, expect, it } from "vitest";
import { SHIKI_BASE_LANGS, SHIKI_THEMES } from "../shikiAdapter";

// SHIKI_BASE_LANGS holds Shiki aliases (e.g. "bash"); the vite.config regex
// matches grammar FILE names (e.g. "shellscript"). Resolve alias -> file name
// using Shiki's own registry so the mapping can't itself drift.
const aliasToFile = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
  aliasToFile.set(info.id, info.id);
  for (const alias of info.aliases ?? []) aliasToFile.set(alias, info.id);
}
const grammarFile = (lang: string) => aliasToFile.get(lang) ?? lang;

// Pull the two eager allow-list alternations out of vite.config.ts. Both look
// like `(a|b|c)\.m?js$`; pick the language one by "shellscript", the theme one
// by "github-dark".
const viteConfig = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
const alternations = [
  ...viteConfig.matchAll(/\(([a-z0-9-|]+)\)\\\.m\?js\$/g),
].map((m) => m[1].split("|"));
const eagerLangFiles = new Set(
  alternations.find((a) => a.includes("shellscript")) ?? [],
);
const eagerThemes = new Set(
  alternations.find((a) => a.includes("github-dark")) ?? [],
);

describe("Shiki eager-chunk allow-list in vite.config", () => {
  describe("given the manualChunks eager regexes are parsed from vite.config", () => {
    it("finds a non-empty eager language and theme set", () => {
      expect(eagerLangFiles.size).toBeGreaterThan(0);
      expect(eagerThemes.size).toBeGreaterThan(0);
    });

    it("keeps every canonical base language eager", () => {
      for (const lang of SHIKI_BASE_LANGS) {
        expect(
          eagerLangFiles.has(grammarFile(lang)),
          `SHIKI_BASE_LANGS includes "${lang}" (grammar file "${grammarFile(
            lang,
          )}") but vite.config manualChunks would lazy-load it. Add it to the eager language regex.`,
        ).toBe(true);
      }
    });

    it("keeps every base theme eager", () => {
      for (const theme of SHIKI_THEMES) {
        expect(
          eagerThemes.has(theme),
          `SHIKI_THEMES includes "${theme}" but vite.config manualChunks would lazy-load it. Add it to the eager theme regex.`,
        ).toBe(true);
      }
    });
  });
});
