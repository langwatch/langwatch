/**
 * @vitest-environment node
 *
 * @see specs/setup/memory-footprint.feature — "The lint rule and the transitive
 * guard ban the same packages"
 *
 * The client/server boundary is enforced twice, on purpose:
 *
 *   - `biome-plugins/no-client-imports-in-server.grit` refuses the direct import
 *     as it is typed, in the editor and in `pnpm lint`;
 *   - `frontend-boundary.unit.test.ts` walks the real import graph and catches
 *     the transitive chain a single-file linter cannot see.
 *
 * Neither subsumes the other, so both have to keep a list of browser-only
 * packages, and the lists have to agree. A package added to one and not the
 * other is the failure this test exists for: the tree still looks guarded, and
 * the half that was not updated waves the import straight through.
 *
 * This compares the package lists only. It deliberately does NOT compare the
 * client source trees (`components/`, `hooks/`, `stores/`), because those are
 * genuinely different jobs — the plugin matches specifier text, the walker
 * resolves paths on disk — and forcing them into one shape would mean weakening
 * one of them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../../..");

const GUARD_TEST = path.join(HERE, "frontend-boundary.unit.test.ts");
const PLUGIN = path.join(
  APP_ROOT,
  "biome-plugins/no-client-imports-in-server.grit",
);

/**
 * The walker's list, read out of its `BROWSER_ONLY` array literal.
 *
 * Every extractor here throws rather than returning empty when its anchor is
 * missing. A parity test that quietly finds nothing on both sides compares two
 * empty sets, passes forever, and is worse than no test at all — it reports
 * that a drift check is running when none is.
 */
const readWalkerPackages = (): string[] => {
  const source = fs.readFileSync(GUARD_TEST, "utf8");
  const block = /const BROWSER_ONLY = \[([\s\S]*?)\];/.exec(source);
  if (!block?.[1]) {
    throw new Error(
      `Could not find the BROWSER_ONLY array in ${GUARD_TEST}. If it was renamed or reshaped, update this extractor — do not delete the check.`,
    );
  }
  const names = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (names.length === 0) {
    throw new Error(`BROWSER_ONLY in ${GUARD_TEST} parsed as empty.`);
  }
  return names;
};

/**
 * The plugin's list, read out of the alternation inside `browser_only_package()`.
 *
 * The plugin writes scoped packages as `@scope/[^"']+` because it anchors on the
 * closing quote — that anchoring is what keeps `reactflow` and `@react-email/*`
 * out of a rule that bans `react`. The subpath matcher is stripped here so the
 * two sides compare as plain package names.
 */
const readPluginPackages = (): string[] => {
  const source = fs.readFileSync(PLUGIN, "utf8");
  const block = /pattern browser_only_package\(\) \{([\s\S]*?)\n\}/.exec(
    source,
  );
  if (!block?.[1]) {
    throw new Error(
      `Could not find pattern browser_only_package() in ${PLUGIN}. If it was renamed, update this extractor — do not delete the check.`,
    );
  }
  const alternation = /\(\?:([^)]*(?:\)[^)]*)*?)\)\(\?:\//.exec(block[1]);
  if (!alternation?.[1]) {
    throw new Error(
      `Could not parse the package alternation in browser_only_package(). Raw pattern:\n${block[1]}`,
    );
  }
  const names = alternation[1]
    .split("|")
    .map((entry) => entry.replace(/\/\[\^\\?"'\]\+$/, "").trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error("browser_only_package() parsed as an empty alternation.");
  }
  return names;
};

describe("given the client/server boundary is guarded by both a lint rule and an import walker", () => {
  describe("when the two ban-lists are compared", () => {
    /** @scenario "The lint rule and the transitive guard ban the same packages" */
    it("bans the same browser-only packages on both sides", () => {
      expect([...readPluginPackages()].sort()).toEqual(
        [...readWalkerPackages()].sort(),
      );
    });
  });

  describe("when the plugin is checked against the config", () => {
    it("is registered in biome.jsonc, without which it lints nothing", () => {
      const config = fs.readFileSync(
        path.join(APP_ROOT, "biome.jsonc"),
        "utf8",
      );

      expect(config).toContain(
        "./biome-plugins/no-client-imports-in-server.grit",
      );
    });

    it("keeps every registered plugin pointing at a file that exists", () => {
      const config = fs.readFileSync(
        path.join(APP_ROOT, "biome.jsonc"),
        "utf8",
      );
      const block = /"plugins": \[([\s\S]*?)\]/.exec(config);
      if (!block?.[1]) {
        throw new Error("biome.jsonc has no plugins array.");
      }
      const registered = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

      expect(registered.length).toBeGreaterThan(0);
      for (const plugin of registered) {
        expect(
          fs.existsSync(path.resolve(APP_ROOT, plugin)),
          `${plugin} is registered in biome.jsonc but does not exist`,
        ).toBe(true);
      }
    });
  });
});
