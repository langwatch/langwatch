/**
 * @vitest-environment node
 *
 * Every checkout in the heavy workflows leaves docs/ and assets/ on the server.
 *
 * Those two directories are the largest in the repository and hold none of
 * CI's inputs — 138 MB and 37 MB of .gif and .mp4 marketing media against
 * 81 MB for platform/. Naming a sparse-checkout makes actions/checkout fetch
 * with `--filter=blob:none`, so the blobs never transfer: a depth-1 clone goes
 * from 180 MB to 39 MB of .git and from 78s to 15s.
 *
 * This is an invariant rather than a list of the jobs that currently have one,
 * because the failure mode is a new job added without it. Nothing breaks; CI
 * just quietly gets slower again, one job at a time, and nobody notices until
 * somebody re-measures a checkout.
 *
 * @see specs/ci/lean-checkout.feature
 * @see .github/workflows/langwatch-app-ci.yml
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** Workflows whose jobs check out the working tree to build or test the app. */
const WORKFLOWS = ["langwatch-app-ci.yml", "e2e-ci.yml"];

const EXCLUDED = ["docs", "assets"];

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  jobs: Record<string, { steps?: Step[] }>;
}

interface CheckoutStep {
  workflow: string;
  job: string;
  sparse: string;
  coneMode: unknown;
}

const checkoutSteps = (file: string): CheckoutStep[] => {
  const workflow = load(
    readFileSync(path.join(REPO_ROOT, ".github/workflows", file), "utf8"),
  ) as Workflow;

  return Object.entries(workflow.jobs).flatMap(([job, definition]) =>
    (definition.steps ?? [])
      .filter((step) => step.uses?.startsWith("actions/checkout@"))
      .map((step) => ({
        workflow: file,
        job,
        sparse: String(step.with?.["sparse-checkout"] ?? ""),
        coneMode: step.with?.["sparse-checkout-cone-mode"],
      })),
  );
};

const ALL = WORKFLOWS.flatMap(checkoutSteps);

/** A gate job reads nothing outside .github, so it takes only that. */
const isGateOnly = (step: CheckoutStep) => step.sparse.trim() === ".github";

const where = (step: CheckoutStep) => `${step.workflow} job "${step.job}"`;

describe("given the workflows that check out the tree to build or test the app", () => {
  it("finds a checkout step in each of them", () => {
    for (const file of WORKFLOWS) {
      expect(
        checkoutSteps(file).length,
        `${file} has no actions/checkout step, so this file is watching nothing`,
      ).toBeGreaterThan(0);
    }
  });

  describe("when a checkout step reads working-tree content", () => {
    /** @scenario "A job that needs the working tree still leaves the media behind" */
    it("excludes every media directory by name", () => {
      for (const step of ALL.filter((s) => !isGateOnly(s))) {
        for (const directory of EXCLUDED) {
          expect(
            step.sparse,
            `${where(step)} checks out ${directory}/, which no job here reads — see specs/ci/lean-checkout.feature`,
          ).toContain(`!/${directory}/`);
        }
      }
    });

    /** @scenario "Cone mode is refused because it would drop a new top-level directory" */
    it("selects non-cone mode, so a new top-level directory arrives by default", () => {
      for (const step of ALL.filter((s) => !isGateOnly(s))) {
        expect(
          step.coneMode,
          `${where(step)} negates paths under cone mode, where negation is not honoured`,
        ).toBe(false);
      }
    });
  });

  describe("when a checkout step belongs to a gate job", () => {
    /** @scenario "A gate job that reads no working tree takes only what it reads" */
    it("takes .github and nothing else", () => {
      const gates = ALL.filter(isGateOnly);

      expect(
        gates.length,
        "no gate job narrows its checkout to .github, so the cheap case regressed",
      ).toBeGreaterThan(0);
    });
  });

  describe("when a checkout step declares no sparse-checkout at all", () => {
    /** @scenario "A new job added without the exclusion fails the check" */
    it("names the job it belongs to", () => {
      const bare = ALL.filter((step) => step.sparse.trim() === "");

      expect(
        bare.map(where),
        "these checkouts pull the full tree, media included",
      ).toEqual([]);
    });
  });
});
