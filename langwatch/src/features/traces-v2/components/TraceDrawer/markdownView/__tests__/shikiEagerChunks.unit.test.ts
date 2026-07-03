/**
 * @vitest-environment jsdom
 *
 * Drift guard: exercises the REAL `shikiManualChunk()` that vite.config's
 * `manualChunks` delegates to. Every canonical base language / theme
 * (SHIKI_BASE_LANGS / SHIKI_THEMES, owned by shikiAdapter.ts) must be
 * force-kept in the eager "shiki" chunk, and a non-base grammar must NOT be.
 * If the eager allow-list in shikiChunking.ts drifts from the canonical lists,
 * this fails loudly — without depending on the config's source formatting.
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
const langPath = (lang: string) =>
  `/repo/node_modules/.pnpm/@shikijs+langs@3.23.0/node_modules/@shikijs/langs/dist/${langFile(
    lang,
  )}.mjs`;
const themePath = (theme: string) =>
  `/repo/node_modules/.pnpm/@shikijs+themes@3.23.0/node_modules/@shikijs/themes/dist/${theme}.mjs`;

const baseFiles = new Set(SHIKI_BASE_LANGS.map(langFile));

describe("shikiManualChunk (vite.config eager Shiki allow-list)", () => {
  describe("given a canonical base language", () => {
    it("force-keeps every SHIKI_BASE_LANGS grammar in the eager chunk", () => {
      for (const lang of SHIKI_BASE_LANGS) {
        expect(
          shikiManualChunk(langPath(lang)),
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

  describe("given a grammar that is not a base language", () => {
    it("leaves it to split into its own lazy chunk", () => {
      const nonBase = bundledLanguagesInfo.find((i) => !baseFiles.has(i.id));
      expect(
        nonBase,
        "expected at least one non-base bundled grammar",
      ).toBeDefined();
      expect(shikiManualChunk(langPath(nonBase!.id))).toBeUndefined();
    });
  });

  describe("given a Shiki core module", () => {
    it("keeps the engine eager", () => {
      expect(
        shikiManualChunk(
          "/repo/node_modules/.pnpm/@shikijs+core@3.23.0/node_modules/@shikijs/core/dist/index.mjs",
        ),
      ).toBe("shiki");
    });
  });
});
