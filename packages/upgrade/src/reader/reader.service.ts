import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

import { SERVING_ROSTER_TIMING } from "../gate/serving-roster-timing.ts";
import {
  upgradeRunKindSchema,
  upgradeRunOutcomeSchema,
  upgradeStepStatusSchema,
} from "../ledger.ts";
import { planInstallation, type UpgradePlanning } from "../plan/plan-installation.ts";
import type { UpgradeClickHouse, UpgradePostgres } from "../ports.ts";
import {
  gooseSteps,
  prismaSteps,
  readGooseVersions,
  readPrismaMigrations,
} from "../seed-sources.ts";
import { computeInstallationState, describeInstallationState } from "./installation-state.ts";
import { preflightFrom, type UpgradePreflightRow } from "./preflight.ts";
import { previewUpgradeTo, type UpgradePreview } from "./preview.ts";
import {
  type LedgerLeaseRow,
  type LedgerRosterRow,
  type LedgerRunFact,
  type LedgerRunRow,
  type LedgerStepRow,
  type LedgerStepFact,
  type LedgerTables,
  UpgradeReaderRepository,
} from "./reader.repository.ts";
import type {
  InstalledOrigin,
  ListRunsInput,
  ListStepsFilter,
  UpgradeFloor,
  UpgradeImage,
  UpgradeImageStep,
  UpgradeLeaseView,
  UpgradeReleasePage,
  UpgradeReleaseSummary,
  UpgradeRunDetail,
  UpgradeRunPage,
  UpgradeRunSummary,
  UpgradeStatus,
  UpgradeStepDetail,
  UpgradeStepPage,
  UpgradeStepView,
  UpgradeTargetSummary,
} from "./reader.schema.ts";
import { compareReleasesNewestFirst, pickHighestRelease } from "./release.ts";
import { parseRunPhases } from "./run-phase-view.ts";
import {
  filterSteps,
  imageReleaseRow,
  mergeSteps,
  viewDeclaredStep,
  viewRecordedStep,
} from "./step-view.ts";

const DEFAULT_RUN_PAGE = 25;
const MAX_RUN_PAGE = 100;

const cursorSchema = z.tuple([z.string().regex(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/), z.string()]);

function summariseRun(run: LedgerRunRow): UpgradeRunSummary {
  return {
    id: run.id,
    kind: run.kind,
    release: run.release,
    floor: run.floor,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    outcome: run.outcome,
  };
}

function viewLease(lease: LedgerLeaseRow): UpgradeLeaseView {
  return {
    name: lease.name,
    owner: lease.owner,
    image: lease.image,
    host: lease.host,
    heartbeatAt: lease.heartbeat_at,
    expiresAt: lease.expires_at,
  };
}

function encodeCursor({ run }: { run: LedgerRunRow }): string {
  return Buffer.from(JSON.stringify([run.started_at, run.id])).toString("base64url");
}

function parseCursor({ cursor }: { cursor: string }): { startedAt: string; id: string } {
  let decoded: unknown = null;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    decoded = null;
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new UpgradeReadError(
      "upgrade_invalid_cursor",
      "The cursor is not one the reader issued.",
    );
  }
  return { startedAt: parsed.data[0], id: parsed.data[1] };
}

function countBy<Item>({
  items,
  key,
}: {
  items: readonly Item[];
  key: (item: Item) => string;
}): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function pickLiveLease({ leases }: { leases: readonly LedgerLeaseRow[] }): LedgerLeaseRow | null {
  const live = leases.filter((lease) => lease.live);
  const newest = live.toSorted((left, right) =>
    (right.heartbeat_at ?? "").localeCompare(left.heartbeat_at ?? ""),
  );
  return newest[0] ?? null;
}

/** The installed release: the newest succeeded run's, else the highest a settled step carries. */
function pickInstalled({
  succeededRun,
  stepFacts,
}: {
  succeededRun: LedgerRunRow | null;
  stepFacts: readonly LedgerStepFact[];
}): { installed: string | null; origin: InstalledOrigin } {
  if (succeededRun?.release) {
    return {
      installed: succeededRun.release,
      origin: succeededRun.kind === "seed" ? "inferred" : "recorded",
    };
  }
  const settled = stepFacts
    .filter((step) => step.status === "done" || step.status === "not-needed")
    .flatMap((step) => (step.release === null ? [] : [step.release]));
  const fallback = pickHighestRelease({ releases: settled });
  return { installed: fallback, origin: fallback ? "inferred" : "none" };
}

function pickStepView({
  row,
  declared,
  imageRelease,
  id,
  roster,
  needsOldWritersGone,
}: {
  row: LedgerStepRow | undefined;
  declared: UpgradeImageStep | undefined;
  imageRelease: string;
  id: string;
  roster: readonly LedgerRosterRow[];
  needsOldWritersGone: ReadonlySet<string>;
}): UpgradeStepView {
  if (row) return viewRecordedStep({ row, declared, roster, needsOldWritersGone });
  if (declared) {
    return viewDeclaredStep({ step: declared, imageRelease, roster, needsOldWritersGone });
  }
  throw new UpgradeReadError("upgrade_not_found", `No upgrade step "${id}" in the ledger.`);
}

function nextCursor({
  runs,
  pageSize,
}: {
  runs: readonly LedgerRunRow[];
  pageSize: number;
}): string | null {
  const last = runs[pageSize - 1];
  return runs.length > pageSize && last ? encodeCursor({ run: last }) : null;
}

function summariseReleases({
  steps,
  image,
  installed,
}: {
  steps: readonly UpgradeStepView[];
  image: UpgradeImage;
  installed: string | null;
}): UpgradeReleaseSummary[] {
  const byRelease = new Map<string | null, UpgradeStepView[]>();
  for (const step of steps)
    byRelease.set(step.release, [...(byRelease.get(step.release) ?? []), step]);
  const imageRow = imageReleaseRow({ release: image.release });
  if (!byRelease.has(imageRow)) byRelease.set(imageRow, []);
  return [...byRelease.entries()]
    .toSorted(([left], [right]) => compareReleasesNewestFirst({ left, right }))
    .map(([release, members]) => ({
      release,
      installed: release !== null && release === installed,
      image: release === imageRow,
      stepCount: members.length,
      counts: countBy({ items: members, key: (step) => step.status }),
    }));
}

/** Ledger facts in the planner's words; a status or kind a newer runner wrote is left out. */
function planFactsFrom({
  stepRows,
  runRows,
}: {
  stepRows: readonly LedgerStepFact[];
  runRows: readonly LedgerRunFact[];
}) {
  const steps = stepRows.flatMap(({ id, status }) => {
    const known = upgradeStepStatusSchema.safeParse(status);
    return known.success ? [{ id, status: known.data }] : [];
  });
  const runs = runRows.flatMap((run) => {
    const kind = upgradeRunKindSchema.safeParse(run.kind);
    const outcome = upgradeRunOutcomeSchema.nullable().safeParse(run.outcome);
    if (!kind.success || !outcome.success) return [];
    const { release, floor, started_at: startedAt } = run;
    return [{ kind: kind.data, outcome: outcome.data, release, floor, startedAt }];
  });
  return { steps, runs };
}

/** The ledger as the planner reads it; an empty or absent one is read from the tools' records. */
async function readPlanFacts({
  repository,
  tables,
  postgres,
  clickhouse,
}: {
  repository: UpgradeReaderRepository;
  tables: LedgerTables;
  postgres: UpgradePostgres;
  clickhouse?: UpgradeClickHouse;
}) {
  const [stepRows, runRows] = await Promise.all([
    repository.findStepFacts({ tables }),
    repository.findRunFacts({ tables }),
  ]);
  if (stepRows.length > 0 || runRows.length > 0) return planFactsFrom({ stepRows, runRows });
  const prisma = prismaSteps({ rows: await readPrismaMigrations({ postgres }) });
  const goose = clickhouse ? gooseSteps({ rows: await readGooseVersions({ clickhouse }) }) : [];
  return { steps: [...prisma, ...goose], runs: [] };
}

/**
 * The read model of the Upgrades page and `upgrade status` (dev/docs/plans/upgrade-ui-2026-10-06.md
 * section 8). It touches only the ledger tables, tolerates unknown kinds and statuses, and is
 * handed the image's release, declared steps, floor and old-writer code steps; reads no manifest.
 */
export function createUpgradeReader({
  postgres,
  image,
  floor,
  needsOldWritersGone = new Set(),
  planning,
}: {
  postgres: UpgradePostgres;
  image: UpgradeImage;
  floor: UpgradeFloor | null;
  needsOldWritersGone?: ReadonlySet<string>;
  /** The manifests `preview` plans with; ClickHouse seeds goose history into an empty ledger. */
  planning?: UpgradePlanning & { clickhouse?: UpgradeClickHouse };
}) {
  const repository = UpgradeReaderRepository.create({ postgres });
  const declaredById = new Map(image.steps.map((step) => [step.id, step]));
  const findRoster = ({ tables }: { tables: LedgerTables }) =>
    repository.findLiveRoster({ tables, staleAfterMs: SERVING_ROSTER_TIMING.staleAfterMs });

  async function readStatusFacts({ tables }: { tables: LedgerTables }) {
    const [stepFacts, latestRun, succeededRun, floors, leases, unfinishedRun, anyRun, failed] =
      await Promise.all([
        repository.findStepFacts({ tables }),
        repository.findLatestRun({ tables }),
        repository.findLatestSucceededRun({ tables }),
        repository.findRecordedFloors({ tables }),
        repository.findLeases({ tables }),
        repository.hasUnfinishedUpgradeRun({ tables }),
        repository.hasAnyRun({ tables }),
        repository.countFailedTargets({ tables }),
      ]);
    const lease = pickLiveLease({ leases });
    return {
      stepFacts,
      latestRun,
      succeededRun,
      ledgerFloor: pickHighestRelease({ releases: floors }),
      lease,
      holdsLease: tables.lease ? lease !== null : unfinishedRun,
      ledgerHoldsRecords: anyRun || stepFacts.length > 0,
      failedTargets: failed,
    };
  }

  async function status(): Promise<UpgradeStatus> {
    const tables = await repository.findTables();
    const facts = await readStatusFacts({ tables });
    const { installed, origin } = pickInstalled(facts);
    const verdict = computeInstallationState({
      imageRelease: image.release,
      imageSteps: image.steps,
      floor: floor?.release ?? null,
      installed,
      ledgerFloor: facts.ledgerFloor,
      ledgerHoldsRecords: facts.ledgerHoldsRecords,
      steps: facts.stepFacts,
      failedTargets: facts.failedTargets,
      holdsLease: facts.holdsLease,
    });
    return {
      ...verdict,
      ...describeInstallationState({ state: verdict.state }),
      installed,
      origin,
      image: image.release,
      floor: floor?.release ?? null,
      ledgerFloor: facts.ledgerFloor,
      lease: facts.lease ? viewLease(facts.lease) : null,
      lastRun: facts.latestRun ? summariseRun(facts.latestRun) : null,
      counts: countBy({ items: facts.stepFacts, key: (step) => step.status }),
      failedStepIds: facts.stepFacts.filter((step) => step.status === "failed").map((s) => s.id),
      failedTargets: facts.failedTargets,
    };
  }

  async function listAllSteps({ tables }: { tables: LedgerTables }): Promise<UpgradeStepView[]> {
    const [rows, roster] = await Promise.all([
      repository.findSteps({ tables }),
      findRoster({ tables }),
    ]);
    return mergeSteps({ rows, image, roster, needsOldWritersGone });
  }

  async function listSteps(filter: ListStepsFilter = {}): Promise<UpgradeStepPage> {
    const steps = await listAllSteps({ tables: await repository.findTables() });
    return { items: filterSteps({ steps, filter }), cursor: null };
  }

  async function listReleases(): Promise<UpgradeReleasePage> {
    const tables = await repository.findTables();
    const [steps, facts] = await Promise.all([
      listAllSteps({ tables }),
      readStatusFacts({ tables }),
    ]);
    const { installed } = pickInstalled(facts);
    return { items: summariseReleases({ steps, image, installed }), cursor: null };
  }

  async function getStep({ id }: { id: string }): Promise<UpgradeStepDetail> {
    const tables = await repository.findTables();
    const [[row], roster] = await Promise.all([
      repository.findStepById({ tables, id }),
      findRoster({ tables }),
    ]);
    const declared = declaredById.get(id);
    const view = pickStepView({
      row,
      declared,
      imageRelease: image.release,
      id,
      roster,
      needsOldWritersGone,
    });
    const targets = await repository.findTargets({ tables, stepId: id });
    return {
      ...view,
      targets: targets.map((target) => ({
        target: target.target,
        status: target.status,
        version: target.version,
        lastError: target.last_error,
        updatedAt: target.updated_at,
      })),
    };
  }

  async function listRuns({ cursor, limit }: ListRunsInput = {}): Promise<UpgradeRunPage> {
    const tables = await repository.findTables();
    const pageSize = Math.min(limit ?? DEFAULT_RUN_PAGE, MAX_RUN_PAGE);
    const after = cursor ? parseCursor({ cursor }) : null;
    const runs = await repository.findRuns({ tables, after, limit: pageSize + 1 });
    return {
      items: runs.slice(0, pageSize).map(summariseRun),
      cursor: nextCursor({ runs, pageSize }),
    };
  }

  async function getRun({ id }: { id: string }): Promise<UpgradeRunDetail> {
    const tables = await repository.findTables();
    const [run] = await repository.findRunById({ tables, id });
    if (!run) {
      throw new UpgradeReadError("upgrade_not_found", `No upgrade run "${id}" in the ledger.`);
    }
    const [rows, roster] = await Promise.all([
      repository.findSteps({ tables, runId: id }),
      findRoster({ tables }),
    ]);
    return {
      ...summariseRun(run),
      plan: run.plan,
      report: run.report,
      phases: parseRunPhases({ report: run.report }),
      steps: rows.map((row) =>
        viewRecordedStep({
          row,
          declared: declaredById.get(row.id),
          roster,
          needsOldWritersGone,
        }),
      ),
    };
  }

  /** The preflight an upgrade's preview shows, in the checkup's verdict shape (plan 6.1.3). */
  async function preflight(): Promise<UpgradePreflightRow[]> {
    return preflightFrom({ status: await status() });
  }

  /** `upgrade plan --to` as the preview page shows it, beside the preflight (U6-U9-READER). */
  async function preview({ to }: { to: string }): Promise<UpgradePreview> {
    if (!planning) {
      throw new UpgradeReadError(
        "upgrade_plan_unavailable",
        "this upgrade reader was created without the planning a preview needs",
      );
    }
    const tables = await repository.findTables();
    const { installed, plan } = planInstallation({
      ...planning,
      ...(await readPlanFacts({ repository, tables, postgres, clickhouse: planning.clickhouse })),
    });
    return {
      installed,
      plan: previewUpgradeTo({ plan, image: planning.image, to }),
      preflight: await preflight(),
    };
  }

  /** Every ledger target rolled up from one summed query (U6-U9-READER). */
  async function listTargets(): Promise<UpgradeTargetSummary[]> {
    const tables = await repository.findTables();
    const rows = await repository.findTargetSummaries({ tables });
    return rows.map((row) => ({
      target: row.target,
      version: row.version,
      outstanding: row.outstanding,
      lastError: row.last_error,
    }));
  }

  return {
    status,
    listReleases,
    listSteps,
    getStep,
    listRuns,
    getRun,
    preflight,
    preview,
    listTargets,
  };
}

export type UpgradeReader = ReturnType<typeof createUpgradeReader>;

export type UpgradeReadErrorCode =
  | "upgrade_not_found"
  | "upgrade_invalid_cursor"
  | "upgrade_plan_unavailable";

const HTTP_STATUS: Record<UpgradeReadErrorCode, number> = {
  upgrade_not_found: 404,
  upgrade_invalid_cursor: 400,
  upgrade_plan_unavailable: 503,
};

/** A read the ledger cannot answer. Consumers branch on `code`, never on the message. */
export class UpgradeReadError extends HandledError {
  declare readonly code: UpgradeReadErrorCode;

  constructor(code: UpgradeReadErrorCode, message: string) {
    super(code, message, {
      httpStatus: HTTP_STATUS[code],
      fault: code === "upgrade_plan_unavailable" ? "platform" : "customer",
    });
    this.name = "UpgradeReadError";
  }
}
