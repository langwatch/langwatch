/**
 * Regression guard: the runtime image must ship every root-level workspace
 * package the app depends on at runtime.
 *
 * The builder stage does `COPY packages ./packages`, but the runtime stage
 * cherry-picks individual packages to keep the image slim. pnpm links these as
 * `platform/app/node_modules/@langwatch/<name> -> ../../../../packages/<name>`, and
 * that symlink is copied along with `platform/app/`. If the package it points at
 * is not also copied, the link dangles and the process dies at boot with
 * `Cannot find module '@langwatch/<name>'` — which is exactly how
 * `@langwatch/handled-error` broke the workers entry point after it was added
 * as a root workspace package but never added to the runtime stage.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// src/__tests__/ -> ../../ = platform/app/ -> ../../../../ = repo root
const APP_DIR = path.join(__dirname, "../..");
const REPO_ROOT = path.join(APP_DIR, "../..");
const DOCKERFILE_PATH = path.join(REPO_ROOT, "infra/docker/Dockerfile");
const ROOT_PACKAGES_DIR = path.join(REPO_ROOT, "packages");

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
}

const appPkg: PackageJson = JSON.parse(
  readFileSync(path.join(APP_DIR, "package.json"), "utf-8"),
);

/**
 * Maps each root-level `packages/<dir>` to its declared package name, so the
 * dependency list can be matched by name rather than by assuming dir === name.
 */
function rootPackagesByName(): Map<string, string> {
  const byName = new Map<string, string>();
  for (const dir of readdirSync(ROOT_PACKAGES_DIR)) {
    const manifest = path.join(ROOT_PACKAGES_DIR, dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name }: PackageJson = JSON.parse(readFileSync(manifest, "utf-8"));
    if (name) byName.set(name, dir);
  }
  return byName;
}

/**
 * The runtime stage is everything after the final `FROM` — the builder stages
 * copy the whole `packages` tree and are not what ships.
 */
function runtimeStage(dockerfile: string): string {
  const lastFrom = [...dockerfile.matchAll(/^FROM .*$/gm)].at(-1);
  if (lastFrom?.index === undefined) {
    throw new Error("no FROM instruction found in Dockerfile");
  }
  return dockerfile.slice(lastFrom.index);
}

const stage = runtimeStage(readFileSync(DOCKERFILE_PATH, "utf-8"));
const rootPackages = rootPackagesByName();

/** Root-level workspace packages the app needs at runtime (prod deps only). */
const requiredDirs = Object.entries(appPkg.dependencies ?? {})
  .filter(([, spec]) => spec.startsWith("workspace:"))
  .map(([name]) => rootPackages.get(name))
  .filter((dir): dir is string => dir !== undefined);

describe("Dockerfile runtime stage", () => {
  describe("when the runtime stage assembles its node_modules", () => {
    it("copies the workspace store before the app tree", () => {
      // Since ADR-076 the install root is /app, so pnpm's virtual store lives
      // at /app/node_modules/.pnpm and EVERY entry in platform/app/node_modules
      // is a symlink into it. Omitting this copy builds a clean image whose
      // container dies on its first import — there is no build error to catch
      // it, which is how it shipped broken once already.
      const storeCopy = stage.search(
        /COPY --from=builder \/app\/node_modules\s+\.\/node_modules/,
      );
      const appCopy = stage.search(
        /COPY --from=builder \/app\/platform\/app\s+\.\/platform\/app/,
      );

      expect(
        storeCopy,
        "runtime stage must COPY /app/node_modules",
      ).toBeGreaterThan(-1);
      expect(
        appCopy,
        "runtime stage must COPY /app/platform/app",
      ).toBeGreaterThan(-1);
      expect(
        storeCopy,
        "the store copy must precede the app copy — the app tree is symlinks into it",
      ).toBeLessThan(appCopy);
    });
  });

  describe("when the app depends on a root-level workspace package", () => {
    it("finds the root workspace packages the app depends on", () => {
      // Guards the guard: if this list ever empties, the assertions below
      // would vacuously pass and stop protecting anything.
      expect(requiredDirs).toContain("handled-error");
      expect(requiredDirs).toContain("langy");
    });

    it.each(
      requiredDirs,
    )("copies packages/%s into the runtime image", (dir) => {
      // Copying the whole tree satisfies this more strongly than naming the
      // package: it cannot go stale when a new root workspace package is
      // added. Either shape is accepted; neither being present is the bug.
      const hasWholeTreeCopy =
        /COPY --from=builder \/app\/packages\s+\.\/packages/.test(stage);

      expect(
        hasWholeTreeCopy || stage.includes(`/app/packages/${dir}`),
        `The runtime stage must COPY /app/packages/${dir} (or the whole /app/packages tree) — platform/app/node_modules/@langwatch/* symlinks into it, so omitting it makes the app fail at boot with "Cannot find module".`,
      ).toBe(true);
    });
  });
});
