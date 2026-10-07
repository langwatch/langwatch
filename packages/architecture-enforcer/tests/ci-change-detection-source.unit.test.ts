/**
 * @vitest-environment node
 * Guards where CI path gates read a pull request's changed paths: git, never
 * the files API, which stops at 3,000 files (specs/ci/path-filters.feature).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const DETECTOR = path.join(REPO_ROOT, ".github/actions/detect-changes/action.yml");

interface Step {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  on?: unknown;
  jobs?: Record<string, { steps?: Step[] }>;
}

const DORNY = "dorny/paths-filter@";
/** A step `if` that pins one event other than a pull request. */
const NON_PR_EVENT_ONLY =
  /^github\.event_name\s*==\s*'(push|merge_group|schedule|workflow_dispatch)'$/;

function triggers({ workflow }: { workflow: Workflow }): string[] {
  const on = workflow.on;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  return on && typeof on === "object" ? Object.keys(on) : [];
}

const directUses = readdirSync(WORKFLOWS)
  .filter((file) => /\.ya?ml$/.test(file))
  .flatMap((file) => {
    const workflow = load(readFileSync(path.join(WORKFLOWS, file), "utf8")) as Workflow;
    const onPullRequest = triggers({ workflow }).includes("pull_request");
    return Object.entries(workflow.jobs ?? {}).flatMap(([job, { steps = [] }]) =>
      steps
        .filter((step) => step.uses?.startsWith(DORNY))
        .map((step) => ({
          where: `${file} job ${job}`,
          step,
          runsOnPullRequest: onPullRequest && !NON_PR_EVENT_ONLY.test((step.if ?? "").trim()),
        })),
    );
  });

describe("where CI path gates read a pull request's changed paths", () => {
  describe("given a workflow that calls dorny/paths-filter directly", () => {
    /** @scenario "A workflow that calls dorny/paths-filter directly reads pull requests with git" */
    it("passes an empty token whenever the step can run on a pull request", () => {
      const onPullRequest = directUses.filter((use) => use.runsOnPullRequest);
      expect(onPullRequest.length).toBeGreaterThan(0);
      for (const { where, step } of onPullRequest) {
        expect(step.with?.token, `${where} would read the files API`).toBe("");
      }
    });
  });

  describe("given the shared change detector", () => {
    const detector = load(readFileSync(DETECTOR, "utf8")) as { runs: { steps: Step[] } };
    const step = (id: string): Step => detector.runs.steps.find((s) => s.id === id)!;

    it("hands dorny the token only when the source script chose the API", () => {
      expect(step("source").run).toContain("scripts/detect-changes-source.sh");
      expect(step("filter").uses).toContain(DORNY);
      expect(step("filter").with?.token).toBe(
        "${{ steps.source.outputs.source == 'api' && github.token || '' }}",
      );
      expect(step("force").if).toBe("steps.source.outputs.source == 'force'");
    });
  });
});
