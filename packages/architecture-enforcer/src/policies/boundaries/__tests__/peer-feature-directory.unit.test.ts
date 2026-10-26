/** Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13b. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FeatureCatalogueEntry } from "../../../types.ts";
import {
  collectPeerFeatureDirectories,
  lintPeerFeatureDirectory,
} from "../peer-feature-directory.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ modules, folders }: { modules: readonly string[]; folders: readonly string[] }) {
  const root = mkdtempSync(join(tmpdir(), "peer-feature-directory-"));
  roots.push(root);
  for (const folder of folders) mkdirSync(join(root, folder), { recursive: true });
  const catalogue = modules.map((id): FeatureCatalogueEntry => ({
    id,
    root: `modules/${id}`,
    classification: "core",
    subjects: [id],
  }));

  return { root, catalogue };
}

const MODULES = ["trace", "annotation", "ops", "feature-flag", "automation", "slack"];

describe("peer-feature-directory", () => {
  describe("given trace has a feature folder called annotation", () => {
    describe("when the modules are read", () => {
      /** @scenario "A feature folder named after another module is reported" */
      it("reports the folder naming annotation", () => {
        const workspace = fixture({
          modules: MODULES,
          folders: ["modules/trace/browser/src/features/annotation/components"],
        });

        expect(collectPeerFeatureDirectories(workspace)).toEqual([
          {
            module: "trace",
            directory: "modules/trace/browser/src/features/annotation",
            peer: "annotation",
          },
        ]);
      });
    });
  });

  describe("given plural and hyphenated folder names", () => {
    describe("when the modules are read", () => {
      /** @scenario "A plural or hyphenated folder name naming a module is reported" */
      it("reports both with the module each names", () => {
        const workspace = fixture({
          modules: MODULES,
          folders: [
            "modules/ops/browser/src/features/feature-flags",
            "modules/automation/browser/src/features/slack-templates",
          ],
        });

        expect(collectPeerFeatureDirectories(workspace).map((item) => item.peer)).toEqual([
          "feature-flag",
          "slack",
        ]);
      });
    });
  });

  describe("given folders named for the module's own work", () => {
    describe("when the modules are read", () => {
      /** @scenario "A feature folder named for the module's own work is not reported" */
      it("reports nothing", () => {
        const workspace = fixture({
          modules: MODULES,
          folders: [
            "modules/trace/browser/src/features/span-tree",
            "modules/annotation/process/src/features/annotation-queue",
          ],
        });

        expect(collectPeerFeatureDirectories(workspace)).toEqual([]);
      });
    });
  });

  describe("given a folder named after another module", () => {
    describe("when the finding is linted", () => {
      /** @scenario "A peer-feature-directory finding says what to do instead" */
      it("tells it to move or rename the folder", () => {
        const workspace = fixture({
          modules: MODULES,
          folders: ["modules/trace/browser/src/features/annotation"],
        });
        const [finding] = lintPeerFeatureDirectory(workspace);

        expect(finding?.message).toContain("named after the annotation module, inside trace");
        expect(finding?.allowed).toContain("Move the folder into the module it is named after");
      });
    });
  });
});
