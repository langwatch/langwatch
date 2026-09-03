/**
 * @vitest-environment node
 *
 * Vite reads an `optimizeDeps.include` entry as a chain: each package after a
 * `>` is looked up as a dependency of the one before it, not of the
 * application. `apps/ui` does not depend on Shiki — `@langwatch/design-system`
 * does — so the bare names the list used to carry described a dependency graph
 * that does not exist, and Vite answered with five "Failed to resolve
 * dependency" errors on every boot and pre-bundled none of it.
 *
 * What is checked here is that graph: every link in every chain is a
 * dependency the manifest at the previous link actually declares.
 *
 * Corresponds to specs/setup/dev-stack-boot-noise.feature.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SHIKI_PREBUNDLE_INCLUDE } from "../vite/shiki-prebundle";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_MANIFEST = path.resolve(HERE, "../package.json");

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function manifestAt(file: string): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

function declaredBy(manifest: Manifest): string[] {
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
}

/**
 * Where `name`'s manifest is, looked up from the package that named it.
 *
 * By path rather than through `require.resolve`, because a package whose
 * `exports` map does not list "./package.json" — the design system is one —
 * cannot be resolved that way at all, and the manifest is exactly what this
 * needs to read.
 */
function manifestFileOf(name: string, fromManifest: string): string {
  // Through the symlink first: pnpm links a package into its dependent's
  // node_modules, and its OWN dependencies live beside its real location in
  // the virtual store, not beside the link.
  let directory = path.dirname(realpathSync(fromManifest));
  for (;;) {
    const candidate = path.join(directory, "node_modules", name, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`no manifest for ${name} above ${path.dirname(fromManifest)}`);
    }
    directory = parent;
  }
}

/**
 * The chain an entry describes, as the pairs Vite has to be able to walk:
 * `["a", "b", "c"]` is `a` depending on `b` depending on `c`.
 */
function chainOf(entry: string): string[] {
  return entry.split(">").map((segment) => segment.trim());
}

describe("given the browser application pre-bundles the syntax highlighter", () => {
  describe("when Vite reads the dependency list", () => {
    /** @scenario "A pre-bundled dependency is named through the package that owns it" */
    it("names every link as a dependency the previous link declares", () => {
      for (const entry of SHIKI_PREBUNDLE_INCLUDE) {
        const chain = chainOf(entry);
        let manifestFile = UI_MANIFEST;
        let manifest = manifestAt(manifestFile);

        for (const dependency of chain) {
          expect(
            declaredBy(manifest),
            `${manifest.name} does not depend on ${dependency}, so "${entry}" describes a graph that is not there`,
          ).toContain(dependency);
          manifestFile = manifestFileOf(dependency, manifestFile);
          manifest = manifestAt(manifestFile);
        }
      }
    });

    /** @scenario "A pre-bundled dependency is named through the package that owns it" */
    it("names them through the design system, because this package depends on none of them", () => {
      const ui = declaredBy(manifestAt(UI_MANIFEST));

      // The reason the entries are written the long way. If this package ever
      // takes Shiki as a dependency of its own, the bare names become correct
      // and this list should shorten with it.
      expect(ui).not.toContain("shiki");
      expect(ui.filter((name) => name.startsWith("@shikijs/"))).toEqual([]);

      for (const entry of SHIKI_PREBUNDLE_INCLUDE) {
        expect(chainOf(entry)[0]).toBe("@langwatch/design-system");
      }
    });

    /** @scenario "A pre-bundled dependency is named through the package that owns it" */
    it("still pre-bundles the engine and the grammars, not only the entry package", () => {
      const leaves = SHIKI_PREBUNDLE_INCLUDE.map((entry) => chainOf(entry).at(-1));

      expect(leaves).toContain("shiki");
      expect(leaves).toContain("@shikijs/engine-oniguruma");
      expect(leaves).toContain("@shikijs/langs");
      expect(leaves).toContain("@shikijs/themes");
    });
  });
});
