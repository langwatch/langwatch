/**
 * @vitest-environment node
 *
 * An annotation that binds nothing and says nothing about it.
 *
 * The parity checker has three verdicts an author can see. A scenario with no
 * test is reported unbound. An annotation naming no scenario is reported
 * unknown. Both fail the run and both name the file. There is a fourth, and it
 * is silent: an annotation the extractor reads correctly, whose title is
 * perfectly good, which never reaches the binding table because the walk that
 * looks for the test call could not find one. `collectAllBindings` drops it
 * with a bare `continue`. No count, no file, no diagnostic.
 *
 * That is worse than an unbound scenario, because an unbound scenario is a gap
 * somebody is told about. This is a gap that reads as coverage. The test runs,
 * passes, and appears bound to a requirement that has no record of it.
 *
 * IT HAS ALREADY HAPPENED HERE. A privacy guard was written because a leak of
 * that exact shape reached production. Its third annotation sat on the second
 * line of a long comment block, and bound to nothing for as long as it existed.
 * The suite was green, parity was green, and the requirement had no test
 * against its name. That file is the fixture at the bottom of this one — not a
 * reconstruction of the shape, the artefact itself.
 *
 * WHY THIS IMPORTS THE PREDICATE RATHER THAN RESTATING IT. The acceptance rule
 * is extraction AND proximity. A guard that copies either half agrees with
 * itself and measures a question nobody asked; the first attempt at this guard
 * copied the extraction regex, passed its own mutation, and sat in a file that
 * contained a real unbound annotation the whole time. So both halves come from
 * the checker by import, and if the checker's rule changes this guard changes
 * with it or fails loudly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findScenarioAnnotations,
  isFollowedByTestCall,
} from "../check-feature-parity";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");

/**
 * Every tree that can hold a test file.
 *
 * This deliberately is NOT the set of directories the author of this guard was
 * working in. An earlier version scanned three governance directories and
 * justified the narrowness as declining to report other people's debt. That was
 * wrong twice over, and both ways are worth recording because the reasoning is
 * seductive.
 *
 * It was wrong about coverage: a walk scoped to where the bug was found reports
 * zero everywhere it does not look, and a new dangling annotation outside the
 * scope never fails anything, forever. It was wrong about naming, too — the
 * guard read as a statement about the repository while checking a corner of it,
 * which is the same defect it exists to catch, one level up.
 *
 * The house pattern answers the same concern without the blindness: walk
 * everything, and carry the debt that already exists as data. See
 * `src/features/errors/logic/__tests__/noRawErrorToasts.unit.test.ts:49`, which
 * scans `src` and `ee` whole and holds its known exceptions in an `ALLOWED`
 * set, and `src/server/__tests__/frontend-boundary.unit.test.ts:65`.
 */
const ROOTS = ["src", "ee", "scripts"];

const TEST_FILE_RE = /\.(?:unit|integration|e2e)\.test\.tsx?$/;

/**
 * Dangling annotations that already existed when this guard was written, by
 * file, with the exact count in each.
 *
 * WHY COUNTS AND NOT A FILE LIST. The precedent above allows whole files, and
 * warns in its own comment that a file-level entry blinds the guard to every
 * line that file will ever grow. That warning applies here with force: eleven
 * of these sit in one file, so allowing it outright would silence the twelfth.
 * An exact count keeps every one of these files live — add a dangling
 * annotation to any of them and the number moves and the guard fails.
 *
 * It ratchets in the other direction too. Fix one and the count no longer
 * matches, which fails with a message telling you to lower the number. That is
 * mildly annoying exactly once per fix, and it is the property that stops this
 * table from quietly becoming a list of files nobody checks.
 *
 * WHAT THESE ARE. 98 annotations across 45 files, all under `src`; nothing in
 * `ee` or `scripts` dangles. Four of them are not coverage hygiene — they name
 * requirements about cross-tenant reads, an api key's privilege ceiling, a lost
 * queue marker, and a migration dropping a concurrent write. Each has a passing
 * test and nothing bound to its name.
 *
 * They are recorded rather than fixed because this guard's job is to stop the
 * population growing, and because fixing a requirement's binding means reading
 * the requirement, which is the owning team's call and not a mechanical edit.
 * A second session measured the same population independently and agreed on the
 * order; its first attempt read 113 by reaching for the annotation's end offset
 * through a fallback rather than the `end` the extractor returns, which starts
 * the walk inside the annotation and over-reports.
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
  "src/pages/settings/__tests__/authentication.integration.test.tsx": 1,
  "src/server/analytics/clickhouse/__tests__/join-time-bound-partition-column.unit.test.ts": 3,
  "src/server/analytics/clickhouse/__tests__/offline-experiment-evaluations-joinability.integration.test.ts": 1,
  "src/server/analytics/lwql/__tests__/unknownIdentifier.integration.test.ts": 1,
  "src/server/api/__tests__/permission-declaration.types.unit.test.ts": 11,
  "src/server/api/routers/__tests__/sharedTrace.shareSafe.unit.test.ts": 2,
  "src/server/app-layer/authz/__tests__/authz-engine.migration.unit.test.ts": 3,
  "src/server/app-layer/authz/__tests__/trpc-middleware.unit.test.ts": 1,
  "src/server/app-layer/authz/repositories/__tests__/authz-grants-write.repository.unit.test.ts": 1,
  "src/server/app-layer/identity/__tests__/legacy-sso-string-writes.unit.test.ts": 1,
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
  "src/server/event-sourcing/pipelines/authz-grants/projections/__tests__/authzGrantsWrite.projection.unit.test.ts": 1,
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
 * repository lost its tests. Roughly 3,580 match today.
 *
 * A zero from an empty walk proves nothing, and this guard's whole complaint is
 * about silent nothings — it would be the same defect to ship a guard that
 * passes because it found no files to read.
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
 * Annotations the checker reads and then silently discards.
 *
 * This is `collectAllBindings`' own loop with the `continue` inverted: it
 * collects exactly what that function throws away.
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
     * The reproduction, kept verbatim.
     *
     * Three annotations. Two close their own comment and bind. The third opens
     * the second line of a block comment whose prose runs on below it, and
     * binds nothing — which is how it shipped, and why the requirement it names
     * went untested while everything was green.
     *
     * This fixture is what makes the walk above meaningful. Without a case that
     * fails, a matching count is indistinguishable from a walk that found no
     * files, a predicate that always returns true, or an extractor that reads
     * nothing. Both halves are mutation-proven: forcing `isFollowedByTestCall`
     * to return true, and `findScenarioAnnotations` to return nothing, each
     * turn this red.
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
