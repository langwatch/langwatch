/**
 * @vitest-environment node
 *
 * The gate that decides whether sdk-javascript-ci's `e2e` job runs.
 *
 * That job boots a real LangWatch server and posts real SDK telemetry at it,
 * which makes it the only check in the repo that watches the ingest routes
 * answer over a socket. Its `ingest` path filter is what carries an app-only
 * change to it, and the filter has two ways to be wrong that read as fine:
 * a pattern matching nothing, and a key the change detector never declares as
 * an output, which resolves to an empty string and leaves the job skipped
 * forever rather than failing.
 *
 * @see .github/workflows/sdk-javascript-ci.yml
 * @see .github/actions/detect-changes/action.yml
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.resolve(HERE, "../../..");
const WORKFLOW = path.join(REPO_ROOT, ".github/workflows/sdk-javascript-ci.yml");
const DETECTOR = path.join(REPO_ROOT, ".github/actions/detect-changes/action.yml");

interface WorkflowStep {
  id?: string;
  with?: { filters?: string };
}
interface Workflow {
  jobs: Record<string, { if?: string; outputs?: Record<string, string>; steps?: WorkflowStep[] }>;
}
interface Detector {
  outputs: Record<string, { value: string }>;
  runs: { steps: { id?: string; run?: string }[] };
}

const workflow = load(readFileSync(WORKFLOW, "utf8")) as Workflow;
const detector = load(readFileSync(DETECTOR, "utf8")) as Detector;

/**
 * The `filters` input is a block scalar that dorny/paths-filter loads as YAML
 * in its own right, so the comments inside it are stripped exactly the way
 * they are here. Reading it any other way would not be reading what the action
 * reads.
 */
const filters = load(
  workflow.jobs.changes!.steps!.find((s) => s.id === "detect")!.with!.filters!,
) as Record<string, string[]>;

/**
 * Every pattern in this workflow is one of two shapes: a directory prefix
 * ending in `/**`, or an exact repo-relative file path. The matcher below
 * understands those two and nothing else, which is why the shape is asserted
 * before anything is matched: a `*.ts`, a brace list or a `!negation` added
 * later would otherwise be evaluated as a literal filename and silently match
 * nothing, which is the failure this whole suite exists to catch.
 */
const DIRECTORY_PREFIX_SUFFIX = "/**";
const GLOB_METACHARACTERS = /[*?[\]{}()!+@]/;

function isDirectoryPrefix(pattern: string): boolean {
  return (
    pattern.endsWith(DIRECTORY_PREFIX_SUFFIX) &&
    !GLOB_METACHARACTERS.test(pattern.slice(0, -DIRECTORY_PREFIX_SUFFIX.length))
  );
}

function isExactPath(pattern: string): boolean {
  return !GLOB_METACHARACTERS.test(pattern);
}

/**
 * A changed-file list only ever holds files, never bare directory entries, so
 * a directory prefix matches on the separator and an exact path matches on
 * equality.
 */
function matches(pattern: string, file: string): boolean {
  if (isDirectoryPrefix(pattern)) {
    const prefix = pattern.slice(0, -DIRECTORY_PREFIX_SUFFIX.length);
    return file.startsWith(`${prefix}/`);
  }
  return file === pattern;
}

function filterMatches(key: string, files: string[]): boolean {
  return filters[key]!.some((p) => files.some((f) => matches(p, f)));
}

function holdsAtLeastOneFile(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && holdsAtLeastOneFile(path.join(dir, entry.name))) return true;
  }
  return false;
}

/** A pattern that resolves to nothing on disk can never match a changed file. */
function isLive(pattern: string): boolean {
  const target = path.join(
    REPO_ROOT,
    isDirectoryPrefix(pattern) ? pattern.slice(0, -DIRECTORY_PREFIX_SUFFIX.length) : pattern,
  );
  return isDirectoryPrefix(pattern)
    ? holdsAtLeastOneFile(target)
    : existsSync(target) && statSync(target).isFile();
}

const EVERY_PATTERN = Object.entries(filters).flatMap(([key, patterns]) =>
  patterns.map((pattern) => ({ key, pattern })),
);

/**
 * File lists as `git show --name-only --format=` reports them. Held here
 * rather than read from git because the unit shards check out at the default
 * fetch depth of a single commit, where neither revision is reachable: a
 * git-backed read would pass on a developer machine and fail in CI.
 *
 * Both change-sets predate the platform application's removal, and every path
 * they name has moved. The historical list is kept verbatim under `wasFiles`
 * — it is the evidence for why this guard exists — and `files` restates the
 * same change against the tree that serves those routes today. Restating is
 * what keeps the guard honest: a fixture whose every path is gone matches no
 * filter, and the test would then be asserting that a change nobody can make
 * any more triggers a lane.
 */
const BREAKS_INGEST = {
  sha: "cea66e8e12fd3de8720bf9ba6978b471d4bd9286",
  what: "capped the OTLP and collector routes, which stopped serving chunked uploads",
  files: [
    "packages/features/trace/server/src/transport/api-rest/collector.api.ts",
    "packages/features/trace/server/src/transport/api-rest/otlp-ingest.api.ts",
    "packages/otlp/src/body.ts",
    "packages/otlp/src/errors.ts",
  ],
  wasFiles: [
    "platform/app/src/app/api/middleware/trace-limit.ts",
    "platform/app/src/components/run-via-api/__tests__/runSnippets.unit.test.ts",
    "platform/app/src/components/run-via-api/runSnippets.ts",
    "platform/app/src/server/app-layer/usage/__tests__/usage.service.unit.test.ts",
    "platform/app/src/server/app-layer/usage/errors.ts",
    "platform/app/src/server/app-layer/usage/usage.service.ts",
    "platform/app/src/server/data-privacy/__tests__/dataPrivacyPolicy.cache.unit.test.ts",
    "platform/app/src/server/data-privacy/dataPrivacyPolicy.cache.ts",
    "platform/app/src/server/otel/errors.ts",
    "platform/app/src/server/otel/parseOtlpBody.test.ts",
    "platform/app/src/server/otel/parseOtlpBody.ts",
    "platform/app/src/server/routes/__tests__/collector.unit.test.ts",
    "platform/app/src/server/routes/__tests__/otel.logs.unit.test.ts",
    "platform/app/src/server/routes/__tests__/otel.metrics.unit.test.ts",
    "platform/app/src/server/routes/collector.ts",
    "platform/app/src/server/routes/otel.ts",
    "platform/app/src/server/traces/__tests__/clickhouse-trace.service.unit.test.ts",
    "platform/app/src/server/traces/clickhouse-trace.service.ts",
  ],
};

const REPAIRS_INGEST = {
  sha: "ccf7fa772c9412f5f9233b0625152c0a5e692e67",
  what: "moved the body cap into shared route middleware every capped route mounts",
  files: [
    ".github/workflows/npx-server-smoke.yml",
    "packages/api/src/rest/body-limit.ts",
    "packages/api/src/rest/__tests__/body-limit.unit.test.ts",
    "packages/features/trace/server/src/transport/api-rest/collector.api.ts",
    "packages/features/trace/server/src/transport/api-rest/otlp-ingest.api.ts",
  ],
  wasFiles: [
    ".github/workflows/npx-server-smoke.yml",
    "platform/app/src/app/api/scenario-events/[[...route]]/app.ts",
    "platform/app/src/server/routes/_lib/__tests__/body-limit.test.ts",
    "platform/app/src/server/routes/_lib/body-limit.ts",
    "platform/app/src/server/routes/bug-reports.ts",
    "platform/app/src/server/routes/collector.ts",
    "platform/app/src/server/routes/evaluations-legacy.ts",
    "platform/app/src/server/routes/misc.ts",
    "platform/app/src/server/routes/otel.ts",
  ],
};

describe("the sdk-javascript-ci path filters", () => {
  describe("given the filter block the workflow hands to the change detector", () => {
    it("declares only pattern shapes the matcher below understands", () => {
      expect(Object.keys(filters).sort()).toEqual(["ingest", "relevant"]);
      for (const key of Object.keys(filters)) {
        expect(filters[key]!.length).toBeGreaterThan(0);
      }
      for (const { key, pattern } of EVERY_PATTERN) {
        expect(
          isDirectoryPrefix(pattern) || isExactPath(pattern),
          `${key} pattern ${pattern} is neither a directory prefix nor an exact path`,
        ).toBe(true);
      }
    });

    it("points every pattern at something that exists in the repo", () => {
      for (const { key, pattern } of EVERY_PATTERN) {
        expect(isLive(pattern), `${key} pattern ${pattern} matches nothing`).toBe(true);
      }
    });
  });

  describe("when a change touches the ingest spine and no SDK file", () => {
    for (const change of [BREAKS_INGEST, REPAIRS_INGEST]) {
      describe(`given a change that ${change.what}`, () => {
        /** @scenario "A change to the app's HTTP ingest spine runs the SDK end-to-end job" */
        it("matches the ingest filter", () => {
          expect(change.files.length).toBeGreaterThan(0);
          expect(filterMatches("ingest", change.files)).toBe(true);
          expect(workflow.jobs.e2e!.if).toContain("needs.changes.outputs.ingest == 'true'");
          expect(workflow.jobs.e2e!.if).toContain("needs.changes.outputs.relevant == 'true'");
        });

        /** @scenario "A change to the app's HTTP ingest spine does not run the paid SDK test job" */
        it("misses the relevant filter, which is what gates the job that spends model budget", () => {
          expect(filterMatches("relevant", change.files)).toBe(false);
          expect(workflow.jobs.ci!.if).toContain("needs.changes.outputs.relevant == 'true'");
          expect(workflow.jobs.ci!.if).not.toContain("ingest");
        });
      });
    }
  });

  describe("given every filter key the workflow consumes", () => {
    /** @scenario "Every path filter the SDK workflow reads is declared by the change detector" */
    it("finds it declared by the change detector and forced true off the diff path", () => {
      const forceRun = detector.runs.steps.find((s) => s.id === "force")?.run ?? "";

      for (const key of Object.keys(filters)) {
        expect(
          Object.keys(detector.outputs),
          `filter ${key} is consumed but not declared, so it resolves to an empty string`,
        ).toContain(key);
        expect(detector.outputs[key]!.value).toContain(`steps.filter.outputs.${key}`);
        expect(detector.outputs[key]!.value).toContain(`steps.force.outputs.${key}`);
        expect(forceRun).toContain(`${key}=true`);
        expect(workflow.jobs.changes!.outputs?.[key]).toContain(`steps.detect.outputs.${key}`);
      }
    });
  });
});
