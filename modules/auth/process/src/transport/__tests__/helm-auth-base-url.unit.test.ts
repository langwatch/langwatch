/**
 * @vitest-environment node
 *
 * Chart hands NEXTAUTH_URL to every process. File-content regression test;
 * actual rendering tested in charts/langwatch/tests/e2e-overlays.sh.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The repo root that holds `charts/`. Found by walking up from this file until
// the directory turns up, rather than counting `..` from `process.cwd()`: the
// count was correct for exactly one package directory and silently wrong the
// moment the suite moved, which is how it moved here reading
// `modules/charts/`.
const REPO_ROOT = (() => {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(directory, "charts", "langwatch"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("could not find the repository root holding charts/langwatch");
    }
    directory = parent;
  }
  return directory;
})();

const read = (relativePath: string): string =>
  readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");

const HELPERS = "charts/langwatch/templates/_helpers.tpl";
const APP_DEPLOYMENT = "charts/langwatch/templates/app/deployment.yaml";
const WORKERS_DEPLOYMENT = "charts/langwatch/templates/workers/deployment.yaml";

/** The sharedEnv template block, from its define to the next define. */
const sharedEnvBlock = (): string => {
  const helpers = read(HELPERS);
  const start = helpers.indexOf('{{- define "langwatch.sharedEnv" }}');
  if (start === -1) {
    throw new Error(`no langwatch.sharedEnv define in ${HELPERS}`);
  }
  const end = helpers.indexOf("{{- define ", start + 1);
  return helpers.slice(start, end === -1 ? undefined : end);
};

describe("helm chart auth base URL", () => {
  describe("when a pod other than the app runs the app image", () => {
    /** @scenario "The workers pod is told the public address" */
    it("carries NEXTAUTH_URL through sharedEnv into the workers container", () => {
      expect(sharedEnvBlock()).toContain("- name: NEXTAUTH_URL");
      expect(read(WORKERS_DEPLOYMENT)).toContain('include "langwatch.sharedEnv"');
      expect(read(APP_DEPLOYMENT)).toContain('include "langwatch.sharedEnv"');
    });
  });

  describe("when the install names no separate public URL", () => {
    /** @scenario "An install that only names an internal address still agrees with itself" */
    it("falls back from publicUrl to baseHost on the shared entry", () => {
      const entry = sharedEnvBlock().split("- name: NEXTAUTH_URL")[1]!.split("- name:")[0]!;
      expect(entry).toContain(".Values.app.http.publicUrl");
      expect(entry).toContain(".Values.app.http.baseHost");
    });
  });

  describe("when the app deployment renders", () => {
    /** @scenario "The address is declared once per container" */
    it("declares no NEXTAUTH_URL of its own beside the shared entry", () => {
      // NEXTAUTH_URL_INTERNAL is a different key and stays app-only; the
      // negative lookahead keeps it out of this match.
      expect(read(APP_DEPLOYMENT)).not.toMatch(/- name: NEXTAUTH_URL(?!_)/);
    });
  });
});
