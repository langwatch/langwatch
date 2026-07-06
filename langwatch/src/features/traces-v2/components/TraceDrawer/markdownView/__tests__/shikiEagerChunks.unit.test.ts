/**
 * @vitest-environment jsdom
 *
 * Drift guard: exercises the REAL `shikiManualChunk()` that vite.config's
 * `manualChunks` delegates to. Every canonical base language / theme
 * (SHIKI_BASE_LANGS / SHIKI_THEMES, owned by shikiAdapter.ts) must be
 * force-kept in the eager "shiki" chunk; EVERY other bundled grammar must be
 * left lazy; and every Shiki core/engine package must stay eager. If the eager
 * allow-list in shikiChunking.ts drifts or its regexes over-broaden, this fails
 * loudly — without depending on the config's source formatting.
 */
import { bundledLanguagesInfo } from "shiki";
import { describe, expect, it } from "vitest";
import { SHIKI_BASE_LANGS, SHIKI_THEMES } from "../shikiAdapter";
import { shikiManualChunk } from "../shikiChunking";

// Resolve a Shiki lang alias (e.g. "bash") to its grammar FILE name
// (e.g. "shellscript") using Shiki's own registry, so the mapping can't drift.
const aliasToFile = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
  aliasToFile.set(info.id, info.id);
  for (const alias of info.aliases ?? []) aliasToFile.set(alias, info.id);
}
const langFile = (lang: string): string => aliasToFile.get(lang) ?? lang;

// Synthetic module ids of the shape Rollup passes to manualChunks.
const langPath = (file: string) =>
  `/repo/node_modules/.pnpm/@shikijs+langs@3.23.0/node_modules/@shikijs/langs/dist/${file}.mjs`;
const themePath = (theme: string) =>
  `/repo/node_modules/.pnpm/@shikijs+themes@3.23.0/node_modules/@shikijs/themes/dist/${theme}.mjs`;

const baseFiles = new Set(SHIKI_BASE_LANGS.map(langFile));

describe("shikiManualChunk (vite.config eager Shiki allow-list)", () => {
  describe("given a canonical base language", () => {
    it("force-keeps every SHIKI_BASE_LANGS grammar in the eager chunk", () => {
      for (const lang of SHIKI_BASE_LANGS) {
        expect(
          shikiManualChunk(langPath(langFile(lang))),
          `base language "${lang}" (grammar file "${langFile(
            lang,
          )}") must stay eager — update shikiChunking.ts`,
        ).toBe("shiki");
      }
    });
  });

  describe("given a canonical base theme", () => {
    it("force-keeps every SHIKI_THEMES file in the eager chunk", () => {
      for (const theme of SHIKI_THEMES) {
        expect(
          shikiManualChunk(themePath(theme)),
          `base theme "${theme}" must stay eager — update shikiChunking.ts`,
        ).toBe("shiki");
      }
    });
  });

  describe("given every grammar that is not a base language", () => {
    it("leaves all ~340 of them to split into their own lazy chunks", () => {
      const nonBase = bundledLanguagesInfo.filter((i) => !baseFiles.has(i.id));
      expect(nonBase.length).toBeGreaterThan(100);
      const eagerByMistake = nonBase.filter(
        (i) => shikiManualChunk(langPath(i.id)) !== undefined,
      );
      expect(
        eagerByMistake.map((i) => i.id),
        "these non-base grammars are eager but should be lazy — the base-language regex is over-broad",
      ).toEqual([]);
    });
  });

  describe("given a Shiki core / engine package", () => {
    // Every alternation in shikiChunking.ts's SHIKI_CORE regex must stay eager
    // to avoid the boot-cycle white-screen.
    const corePkgPaths: Array<[string, string]> = [
      ["@shikijs/core", "/repo/node_modules/@shikijs/core/dist/index.mjs"],
      [
        "@shikijs/engine-oniguruma",
        "/repo/node_modules/@shikijs/engine-oniguruma/dist/index.mjs",
      ],
      ["shiki", "/repo/node_modules/shiki/dist/index.mjs"],
      ["oniguruma-to-es", "/repo/node_modules/oniguruma-to-es/dist/index.mjs"],
      [
        "oniguruma-parser",
        "/repo/node_modules/oniguruma-parser/dist/index.mjs",
      ],
      [
        "hast-util-to-html",
        "/repo/node_modules/hast-util-to-html/dist/index.mjs",
      ],
    ];
    it.each(corePkgPaths)("keeps %s in the eager chunk", (_pkg, path) => {
      expect(shikiManualChunk(path)).toBe("shiki");
    });
  });

  describe("given a non-Shiki module", () => {
    it("returns undefined (no opinion)", () => {
      expect(
        shikiManualChunk("/repo/node_modules/react/index.js"),
      ).toBeUndefined();
    });
  });
});
