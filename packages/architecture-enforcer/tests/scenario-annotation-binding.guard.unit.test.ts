/**
 * @vitest-environment node
 * Guards a silent failure: an annotation that extracts fine but has no
 * nearby test call is dropped with no diagnostic, reading as bound coverage.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findScenarioAnnotations,
  isFollowedByTestCall,
} from "../src/tools/check-feature-parity.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");

/**
 * Every tree that can hold a test file. Deliberately not scoped to a few
 * governance directories — a scoped walk reports zero everywhere it doesn't
 * look, so a new dangling annotation outside that scope never fails.
 */
const ROOTS = ["src", "ee", "scripts"];

const TEST_FILE_RE = /\.(?:unit|integration|e2e)\.test\.tsx?$/;

/**
 * Dangling annotations that existed when this guard was written, by file with
 * an exact count. A count, not an allow list, ratchets both ways: a new
 * dangling annotation moves it up and fails; fixing one fails until lowered.
 */
const KNOWN_DEBT: Record<string, number> = {
  "src/components/settings/__tests__/ModelProviderForm.advanced-gateway.integration.test.tsx": 3,
  "src/components/settings/__tests__/ModelProviderForm.edit-row-resolution.integration.test.tsx": 2,
  "src/components/traces/__tests__/audioPlayerInTraces.integration.test.tsx": 1,
  "src/features/errors/components/__tests__/HandledErrorAlert.integration.test.tsx": 3,
  "src/features/navigation/__tests__/useNavigationMode.integration.test.tsx": 1,
  "src/features/navigation/logic/__tests__/resolveShellRoute.unit.test.ts": 1,
  "src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx": 7,
  "src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts": 9,
  "src/features/traces-v2/stores/__tests__/traceEditStore.unit.test.ts": 1,
  "src/pages/gateway/__tests__/budgets.scopeChipDetail.unit.test.ts": 1,
  "src/pages/settings/__tests__/security.integration.test.tsx": 1,
  "src/server/analytics/clickhouse/__tests__/join-time-bound-partition-column.unit.test.ts": 3,
  "src/server/analytics/clickhouse/__tests__/offline-experiment-evaluations-joinability.integration.test.ts": 1,
  "src/server/analytics/lwql/__tests__/unknownIdentifier.integration.test.ts": 1,
  "src/server/api/__tests__/permission-declaration.types.unit.test.ts": 11,
  "src/server/api/routers/__tests__/sharedTrace.shareSafe.unit.test.ts": 2,
  "src/server/app-layer/authz/__tests__/authz-engine.migration.unit.test.ts": 3,
  "src/server/app-layer/ops/__tests__/integration/latency-tiles.integration.test.ts": 1,
  "src/server/app-layer/ops/repositories/__tests__/queue.redis.repository.reconcile-pending.unit.test.ts": 1,
  "src/server/app-layer/traces/__tests__/blob-store.event-log.unit.test.ts": 2,
  "src/server/app-layer/traces/__tests__/coding-agent-transcript.derivation.unit.test.ts": 1,
  "src/server/app-layer/traces/__tests__/edge-offload.unit.test.ts": 2,
  "src/server/app-layer/traces/__tests__/large-trace-blob-offload.integration.test.ts": 3,
  "src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts": 8,
  "src/server/app-layer/traces/__tests__/model-cost-matching.unit.test.ts": 1,
  "src/server/evaluators/__tests__/codeEvaluator.unit.test.ts": 1,
  "src/server/event-sourcing/__tests__/pipelineRegistration.unit.test.ts": 1,
  "src/server/event-sourcing/pipelines/authz-grants/__tests__/aggregateIdentity.unit.test.ts": 1,
  "src/server/event-sourcing/pipelines/coding-agent-processing/projections/__tests__/codingAgentSessionEvents.mapProjection.unit.test.ts": 1,
  "src/server/event-sourcing/pipelines/coding-agent-processing/subscribers/__tests__/pullRequestMapping.subscriber.unit.test.ts": 2,
  "src/server/event-sourcing/pipelines/coding-agent-processing/subscribers/__tests__/pullRequestMapping.throttle.integration.test.ts": 1,
  "src/server/event-sourcing/pipelines/trace-processing/commands/__tests__/recordSpanCommand.oversized.unit.test.ts": 3,
  "src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/projectionStores.retentionStamping.unit.test.ts": 1,
  "src/server/event-sourcing/process-manager/__tests__/transientProcessCommit.unit.test.ts": 1,
  "src/server/event-sourcing/queues/groupQueue/__tests__/groupQueue.workerLiveness.unit.test.ts": 1,
  "src/server/event-sourcing/replay/__tests__/replay-projection-parity.integration.test.ts": 2,
  "src/server/event-sourcing/services/__tests__/interposition.unit.test.ts": 1,
  "src/server/event-sourcing/stores/__tests__/eventStoreClickHouse.retentionStamping.unit.test.ts": 2,
  "src/server/modelProviders/__tests__/modelProvider.enabledCollapse.integration.test.ts": 2,
  "src/server/rbac/__tests__/role-binding-resolver.fork.unit.test.ts": 1,
  "src/tasks/__tests__/backfillDatasetContentToS3.unit.test.ts": 3,
};

/**
 * Below this many scanned files, assume the walk broke rather than that the
 * repository lost its tests (roughly 3,580 match today). A zero from an
 * empty walk proves nothing — the same defect as a guard with no files to read.
 */
const SCANNED_FILE_FLOOR = 2_000;

/** Every test file under {@link ROOTS}, as absolute paths. */
function scannedTestFiles(): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    // A tree that does not exist is not a failure of this guard. Anything
    // else is: a directory this walk could not read is a directory whose
    // annotations went unchecked, and swallowing it would leave the file count
    // above its floor while the guard silently stopped looking. The floor
    // catches a walk that found nothing, not one that skipped a subtree.
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      const full = resolve(dir, name);
      if (entry.isDirectory()) {
        if (name === "node_modules" || name === ".next" || name === "dist") {
          continue;
        }
        walk(full);
        continue;
      }
      if (TEST_FILE_RE.test(name)) out.push(full);
    }
  }

  for (const root of ROOTS) walk(resolve(APP_ROOT, root));
  return out;
}

/**
 * Annotations the checker reads and then silently discards — this is
 * `collectAllBindings`'s own loop with the `continue` inverted, collecting
 * exactly what that function throws away.
 */
function danglingAnnotations(
  source: string,
): { title: string; line: number }[] {
  const dangling: { title: string; line: number }[] = [];
  for (const annotation of findScenarioAnnotations(source)) {
    if (isFollowedByTestCall(source, annotation.end)) continue;
    dangling.push({
      title: annotation.title,
      line: source.slice(0, annotation.index).split("\n").length,
    });
  }
  return dangling;
}

describe("given the parity checker drops an annotation it cannot bind", () => {
  describe("when every test file in the repository is walked", () => {
    it("reports any dangling annotation the recorded debt does not account for", () => {
      const files = scannedTestFiles();

      expect(files.length).toBeGreaterThan(SCANNED_FILE_FLOOR);

      /** Actual dangling count per file, and the offenders for the message. */
      const counts: Record<string, number> = {};
      const detail: string[] = [];

      for (const file of files) {
        const source = readFileSync(file, "utf8");
        const dangling = danglingAnnotations(source);
        if (dangling.length === 0) continue;

        const path = relative(APP_ROOT, file).split("\\").join("/");
        counts[path] = dangling.length;
        for (const one of dangling) {
          detail.push(
            `${path}:${one.line} — @scenario ${JSON.stringify(one.title)}`,
          );
        }
      }

      expect(
        counts,
        [
          "The dangling-annotation population changed.",
          "",
          "A @scenario annotation here is read by the parity checker and then dropped",
          "without a diagnostic. It looks like coverage and is not: the scenario it names",
          "has no test bound to it, and the parity run stays green because a dropped",
          "annotation is reported nowhere.",
          "",
          "IF A FILE GAINED ONE — fix it. The annotation must CLOSE its own comment:",
          '  /** @scenario "Some title" */',
          '  it("...", () => {})',
          "",
          "Putting it on the FIRST line of a long block does not work. The walk that looks",
          "for the test call starts immediately after the annotation and cannot get out of",
          "a comment it begins inside, so it lands on the prose below and gives up.",
          "",
          "IF A FILE LOST ONE — you fixed a binding. Lower that file's number in",
          "KNOWN_DEBT, or delete the entry when it reaches zero.",
          "",
          "Every dangling annotation currently found:",
          detail.join("\n"),
        ].join("\n"),
      ).toEqual(KNOWN_DEBT);
    });
  });

  describe("when the annotation sits inside a block whose prose runs on below it", () => {
    /**
     * The reproduction, kept verbatim: the third annotation opens the second
     * line of a block comment whose prose runs on below it and binds nothing.
     * Mutation-proven: forcing either half true/empty each turns this red.
     */
    it("catches the annotation that actually shipped unbound", () => {
      const shipped = [
        '    /** @scenario "An operator-only HTTP status never reaches a customer" */',
        '    it("keeps the status off a customer row", () => {});',
        "",
        '    /** @scenario "The mirror carries no sensitive value onto a customer row" */',
        '    it("keeps the mirror clean", () => {});',
        "",
        "    /**",
        '     * @scenario "The erasure count never rides a span"',
        "     *",
        "     * The span attributes are the one place a count can leave without a",
        "     * reader asking for it, which is how the original leak travelled, and",
        "     * this prose is exactly what stops the walk below from ever reaching",
        "     * the test call underneath it.",
        "     */",
        '    it("keeps the count off every span", () => {});',
      ].join("\n");

      // The extractor sees all three. This is the half a copied-regex guard
      // measures, and it is why that guard passed while the file was broken.
      expect(findScenarioAnnotations(shipped).map((a) => a.title)).toEqual([
        "An operator-only HTTP status never reaches a customer",
        "The mirror carries no sensitive value onto a customer row",
        "The erasure count never rides a span",
      ]);

      // The checker binds two of them. The third is the silent one.
      expect(danglingAnnotations(shipped)).toEqual([
        { title: "The erasure count never rides a span", line: 8 },
      ]);
    });
  });

  describe("when the annotation closes its own comment", () => {
    it("binds it however long the comment above it runs", () => {
      // The distinguishing property is the CLOSE, not the length and not the
      // position. A long block is fine as long as the annotation terminates it.
      const fixed = [
        "    /**",
        "     * A great deal of prose about why this test exists, running on for",
        "     * as long as it needs to, none of which affects the binding.",
        "     */",
        '    /** @scenario "The erasure count never rides a span" */',
        '    it("keeps the count off every span", () => {});',
      ].join("\n");

      expect(danglingAnnotations(fixed)).toEqual([]);
    });
  });
});
