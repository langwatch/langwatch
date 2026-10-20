import { isPrivateTarget, type SchemaTargetReport } from "./schema-applier.ts";

type ClickHouseReport = Extract<SchemaTargetReport, { engine: "clickhouse" }>;

/** The private ClickHouse targets a run holds back, each with the error that held it. */
export type HeldTargets = Map<string, string | null>;

/**
 * Each ClickHouse target upgrades on its own (Alex, 2026-10-11, T7-F1): once another target
 * applied, a failed private target is held and only its organizations wait. With none applied,
 * nothing is held. Spec: specs/upgrade/upgrade-command.feature.
 */
export function newlyHeld({
  reports,
  held,
}: {
  reports: readonly SchemaTargetReport[];
  held: ReadonlyMap<string, string | null>;
}): HeldTargets {
  const clickhouse = reports.filter((report): report is ClickHouseReport => {
    return report.engine === "clickhouse";
  });
  if (!clickhouse.some((report) => report.ok) && held.size === 0) return new Map();
  const failing = clickhouse.filter(
    (report) => !report.ok && isPrivateTarget(report) && !held.has(report.target),
  );
  return new Map(failing.map((report) => [report.target, report.error]));
}

/** The reports, plus a failed one with its held error for each held target the apply skipped. */
export function withHeldReports({
  reports,
  held,
}: {
  reports: readonly SchemaTargetReport[];
  held: ReadonlyMap<string, string | null>;
}): SchemaTargetReport[] {
  const reported = new Set(reports.map((report) => report.target));
  const skipped = [...held].filter(([target]) => !reported.has(target));
  return [
    ...reports,
    ...skipped.map(([target, error]): ClickHouseReport => ({
      engine: "clickhouse",
      target,
      ok: false,
      error,
      applied: null,
    })),
  ];
}

/** Whether a report keeps the installation from going on: any failure but a held target's. */
export function blocksRelease({
  report,
  held,
}: {
  report: SchemaTargetReport;
  held: ReadonlyMap<string, string | null>;
}): boolean {
  return !report.ok && !(report.engine === "clickhouse" && held.has(report.target));
}
