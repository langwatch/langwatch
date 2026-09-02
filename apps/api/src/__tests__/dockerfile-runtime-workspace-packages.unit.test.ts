/**
 * Regression guard: the runtime image must ship every workspace package the
 * three deployables depend on at runtime.
 *
 * The builder stage does `COPY packages ./packages`; the runtime stage is
 * assembled by hand. pnpm links a dependency as
 * `apps/<app>/node_modules/@langwatch/<name> -> ../../../packages/<path>`, and
 * that symlink is copied along with `apps/<app>/`. If the package it points at
 * is not also copied the link dangles and the process dies at boot with
 * `Cannot find module '@langwatch/<name>'` — which is exactly how
 * `@langwatch/handled-error` broke the workers entry point once already.
 *
 * Ported from `platform/app/src/__tests__/` at the deployment cutover, when
 * `platform/app` stopped being in the image at all. The shape of the check is
 * unchanged; what it names is the three applications instead of the monolith.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// src/__tests__/ -> ../../ = apps/api/ -> ../../ = repo root
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.join(APP_DIR, "../..");
const DOCKERFILE_PATH = path.join(REPO_ROOT, "infra/docker/Dockerfile");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

/** The applications the image runs, and the order they are copied in. */
const APPS = ["api", "worker", "ui"] as const;

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
}

/**
 * Maps every workspace package under `packages/` to its declared name, so the
 * dependency lists can be matched by name rather than by assuming the
 * directory and the package name agree. They mostly do not: `@langwatch/api`
 * is `packages/api`, but `@langwatch/trace-server` is
 * `packages/features/trace/server`.
 */
function packagesByName(): Map<string, string> {
  const byName = new Map<string, string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const child = path.join(dir, entry.name);
      const manifest = path.join(child, "package.json");
      if (existsSync(manifest)) {
        const { name }: PackageJson = JSON.parse(readFileSync(manifest, "utf-8"));
        if (name) byName.set(name, path.relative(PACKAGES_DIR, child));
      }
      walk(child, depth + 1);
    }
  };
  walk(PACKAGES_DIR, 0);
  return byName;
}

/**
 * The runtime stage is everything after the final `FROM` — the builder stage
 * copies the whole `packages` tree and is not what ships.
 */
function runtimeStage(dockerfile: string): string {
  const lastFrom = [...dockerfile.matchAll(/^FROM .*$/gm)].at(-1);
  if (lastFrom?.index === undefined) {
    throw new Error("no FROM instruction found in Dockerfile");
  }
  return dockerfile.slice(lastFrom.index);
}

const stage = runtimeStage(readFileSync(DOCKERFILE_PATH, "utf-8"));
const workspacePackages = packagesByName();

/** Workspace packages the three applications need at runtime (prod deps only). */
const requiredPaths = [
  ...new Set(
    APPS.flatMap((app) => {
      const manifest: PackageJson = JSON.parse(
        readFileSync(path.join(REPO_ROOT, "apps", app, "package.json"), "utf-8"),
      );
      return Object.entries(manifest.dependencies ?? {})
        .filter(([, spec]) => spec.startsWith("workspace:"))
        .map(([name]) => workspacePackages.get(name))
        .filter((dir): dir is string => dir !== undefined);
    }),
  ),
];

describe("given the runtime image assembles its node_modules", () => {
  describe("when it copies the application trees", () => {
    it.each(APPS)("copies the workspace store before apps/%s", (app) => {
      // Since ADR-076 the install root is /app, so pnpm's virtual store lives
      // at /app/node_modules/.pnpm and EVERY entry in an application's
      // node_modules is a symlink into it. Omitting this copy builds a clean
      // image whose container dies on its first import — there is no build
      // error to catch it, which is how it shipped broken once already.
      const storeCopy = stage.search(
        /COPY --from=builder \/app\/node_modules\s+\.\/node_modules/,
      );
      const appCopy = stage.search(
        new RegExp(`COPY --from=builder /app/apps/${app}\\s+\\./apps/${app}`),
      );

      expect(storeCopy, "runtime stage must COPY /app/node_modules").toBeGreaterThan(-1);
      expect(appCopy, `runtime stage must COPY /app/apps/${app}`).toBeGreaterThan(-1);
      expect(
        storeCopy,
        "the store copy must precede the app copy — the app tree is symlinks into it",
      ).toBeLessThan(appCopy);
    });

    it("names no monolith path", () => {
      // The image stopped containing platform/app at the deployment cutover. A
      // COPY that survived would fail the build rather than ship silently, but
      // a comment or a CMD that survived would not.
      expect(stage).not.toContain("platform/app");
    });
  });

  describe("when an application depends on a workspace package", () => {
    it("finds the workspace packages the applications depend on", () => {
      // Guards the guard: if this list ever empties, the assertion below would
      // vacuously pass and stop protecting anything.
      expect(requiredPaths).toContain("handled-error");
      expect(requiredPaths).toContain("langy");
    });

    it.each(requiredPaths)("copies packages/%s into the runtime image", (dir) => {
      // Copying the whole tree satisfies this more strongly than naming the
      // package: it cannot go stale when a new workspace package is added.
      // Either shape is accepted; neither being present is the bug.
      const hasWholeTreeCopy = /COPY --from=builder \/app\/packages\s+\.\/packages/.test(
        stage,
      );

      expect(
        hasWholeTreeCopy || stage.includes(`/app/packages/${dir}`),
        `The runtime stage must COPY /app/packages/${dir} (or the whole /app/packages tree) — an application's node_modules/@langwatch/* symlinks into it, so omitting it makes the process fail at boot with "Cannot find module".`,
      ).toBe(true);
    });
  });
});
