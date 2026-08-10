/**
 * @vitest-environment node
 *
 * Every checkout in the heavy workflows leaves the marketing media behind.
 *
 * docs/media, docs/images and assets/ are 165 MB of .gif and .mp4 against
 * 81 MB for platform/, the thing CI builds. Naming a sparse-checkout makes
 * actions/checkout fetch with `--filter=blob:none`, so those blobs never
 * transfer: a depth-1 clone goes from 180 MB to 42 MB of .git.
 *
 * The list below is the MEDIA directories, not docs/ wholesale, and that
 * distinction is why this file names them individually.
 * error-remediation.unit.test.ts resolves the repo's docs/ and asserts every
 * remediation link maps to a real .mdx; excluding all of docs/ failed three
 * test-unit shards. The .mdx tree is ~10 MB of docs/'s 138 and CI reads it;
 * the media is the other 128 and nothing reads it.
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

/**
 * Root-anchored, so `!/assets/` never touches
 * services/langyagent/internal/assets, which a unit test does read.
 */
const EXCLUDED = ["docs/media", "docs/images", "assets"];

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
            `${where(step)} checks out ${directory}/, which is media no job here reads — see specs/ci/lean-checkout.feature`,
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

    /** @scenario "Prose under docs/ is kept, because CI reads it" */
    it("keeps the .mdx tree, dropping only the media beneath it", () => {
      for (const step of ALL.filter((s) => !isGateOnly(s))) {
        expect(
          step.sparse.split("\n").map((line) => line.trim()),
          `${where(step)} drops docs/ wholesale, which fails error-remediation.unit.test.ts`,
        ).not.toContain("!/docs/");
      }
    });

    /** @scenario "The exclusions are root-anchored" */
    it("anchors each exclusion at the root, sparing nested directories of the same name", () => {
      for (const step of ALL.filter((s) => !isGateOnly(s))) {
        for (const line of step.sparse
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("!"))) {
          expect(
            line,
            `${where(step)} has an unanchored exclusion "${line}", which would also drop services/langyagent/internal/assets`,
          ).toMatch(/^!\//);
        }
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
