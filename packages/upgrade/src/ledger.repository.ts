import { generate } from "@langwatch/ksuid";

import { createLedgerTables, type LedgerTableNames, ledgerTables } from "./ledger-tables.ts";
import {
  type DeclaredStep,
  declaredStepSchema,
  type InferredStep,
  type UpgradeLease,
  upgradeLeaseSchema,
  type ServingRosterEntry,
  servingRosterEntrySchema,
  type UpgradeRun,
  type UpgradeRunKind,
  type UpgradeRunOutcome,
  upgradeRunSchema,
  type UpgradeStep,
  type UpgradeStepKind,
  upgradeStepKindSchema,
  upgradeStepSchema,
  type UpgradeStepStatus,
  type UpgradeTarget,
  upgradeTargetSchema,
} from "./ledger.ts";
import type { UpgradePostgres } from "./ports.ts";
import { type UpcastStepInput, upcastStepInputSchema, upcastStepStatus } from "./upcast-steps.ts";

// The columns are TIMESTAMP(3) holding UTC, as Prisma writes them; read back as instants.
const NOW_UTC = `(now() AT TIME ZONE 'UTC')`;
const utc = (column: string, alias: string) => `"${column}" AT TIME ZONE 'UTC' AS "${alias}"`;

const RUN_COLUMNS = [
  `"id"`,
  `"kind"`,
  `"release"`,
  `"floor"`,
  utc("started_at", "startedAt"),
  utc("finished_at", "finishedAt"),
  `"outcome"`,
  `"plan"`,
  `"report"`,
].join(", ");

const STEP_COLUMNS = [
  `"id"`,
  `"kind"`,
  `"release"`,
  `"owner"`,
  `"description"`,
  `"mode"`,
  `"status"`,
  `"inferred"`,
  `"attempt"`,
  `"last_error" AS "lastError"`,
  `"report"`,
  `"run_id" AS "runId"`,
  utc("started_at", "startedAt"),
  utc("finished_at", "finishedAt"),
  utc("updated_at", "updatedAt"),
].join(", ");

const TARGET_COLUMNS = [
  `"step_id" AS "stepId"`,
  `"target"`,
  `"status"`,
  `"version"`,
  `"last_error" AS "lastError"`,
  utc("updated_at", "updatedAt"),
].join(", ");

const LEASE_COLUMNS = [
  `"name"`,
  `"owner"`,
  `"image"`,
  `"host"`,
  utc("heartbeat_at", "heartbeatAt"),
  utc("expires_at", "expiresAt"),
].join(", ");

const ROSTER_COLUMNS = [
  `"process_id" AS "processId"`,
  `"role"`,
  `"image"`,
  `"release"`,
  `"steps"`,
  utc("started_at", "startedAt"),
  utc("heartbeat_at", "heartbeatAt"),
].join(", ");

/** The runner's own ledger tables. Only the runner package reads or writes them. */
export class UpgradeLedgerRepository {
  private constructor(private readonly postgres: UpgradePostgres) {}

  static create({ postgres }: { postgres: UpgradePostgres }): UpgradeLedgerRepository {
    return new UpgradeLedgerRepository(postgres);
  }

  /** Runs `text` against this installation's ledger tables (`ledgerTables`). */
  private async query<Row extends object>(
    text: (tables: LedgerTableNames) => string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }> {
    return this.postgres.query<Row>(text(await ledgerTables({ postgres: this.postgres })), values);
  }

  /** Creates the ledger schema and tables when absent and answers their names. */
  async createTables(): Promise<LedgerTableNames> {
    return createLedgerTables({ postgres: this.postgres });
  }

  async startRun({
    kind,
    floor,
  }: {
    kind: UpgradeRunKind;
    floor?: string | null;
  }): Promise<UpgradeRun> {
    const { rows } = await this.query<object>(
      (t) => `INSERT INTO ${t.run} ("id", "kind", "floor", "started_at")
       VALUES ($1, $2, $3, ${NOW_UTC})
       RETURNING ${RUN_COLUMNS}`,
      [generate("upgraderun").toString(), kind, floor ?? null],
    );
    return upgradeRunSchema.parse(rows[0]);
  }

  async finishRun({
    runId,
    outcome,
    report,
  }: {
    runId: string;
    outcome: UpgradeRunOutcome;
    report: Record<string, unknown>;
  }): Promise<UpgradeRun> {
    const { rows } = await this.query<object>(
      (t) => `UPDATE ${t.run}
          SET "finished_at" = ${NOW_UTC}, "outcome" = $2, "report" = $3::jsonb
        WHERE "id" = $1
       RETURNING ${RUN_COLUMNS}`,
      [runId, outcome, JSON.stringify(report)],
    );
    return upgradeRunSchema.parse(rows[0]);
  }

  /**
   * Writes steps read from another tool's record, marked inferred. A row the runner recorded
   * itself (not inferred) is never overwritten. Answers the kind of every row written.
   */
  async writeInferredSteps({
    runId,
    steps,
  }: {
    runId: string;
    steps: readonly InferredStep[];
  }): Promise<UpgradeStepKind[]> {
    if (steps.length === 0) return [];
    const { rows } = await this.query<{ kind: string }>(
      (t) => `INSERT INTO ${t.step} AS step
              ("id", "kind", "mode", "status", "last_error", "inferred", "run_id", "updated_at")
       SELECT source.id, source.kind, source.mode, source.status, source.last_error, true, $6, ${NOW_UTC}
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS source(id, kind, mode, status, last_error)
       ON CONFLICT ("id") DO UPDATE
          SET "status" = EXCLUDED."status",
              "last_error" = EXCLUDED."last_error",
              "run_id" = EXCLUDED."run_id",
              "updated_at" = EXCLUDED."updated_at"
        WHERE step."inferred"
       RETURNING step."kind"`,
      [
        steps.map((step) => step.id),
        steps.map((step) => step.kind),
        steps.map((step) => step.mode),
        steps.map((step) => step.status),
        steps.map((step) => step.lastError),
        runId,
      ],
    );
    return rows.map((row) => upgradeStepKindSchema.parse(row.kind));
  }

  /**
   * Records each declared upcast as an `event-upcast` background step, its status read from the
   * stored events it still covers. A step a rewrite holds `running` keeps that status.
   */
  async recordUpcastSteps({
    runId,
    steps,
  }: {
    runId: string;
    steps: readonly UpcastStepInput[];
  }): Promise<UpgradeStep[]> {
    if (steps.length === 0) return [];
    const parsed = steps.map((step) => upcastStepInputSchema.parse(step));
    const { rows } = await this.query<object>(
      (t) => `INSERT INTO ${t.step} AS step
              ("id", "kind", "mode", "status", "report", "inferred", "run_id", "updated_at")
       SELECT source.id, 'event-upcast', 'background', source.status, source.report, false, $4, ${NOW_UTC}
         FROM unnest($1::text[], $2::text[], $3::jsonb[]) AS source(id, status, report)
       ON CONFLICT ("id") DO UPDATE
          SET "status" = CASE WHEN step."status" = 'running' THEN step."status" ELSE EXCLUDED."status" END,
              "report" = EXCLUDED."report",
              "run_id" = EXCLUDED."run_id",
              "updated_at" = EXCLUDED."updated_at"
       RETURNING ${STEP_COLUMNS}`,
      [
        parsed.map((step) => step.id),
        parsed.map((step) => upcastStepStatus(step)),
        parsed.map((step) => JSON.stringify({ ...step.report, storedEvents: step.storedEvents })),
        runId,
      ],
    );
    return rows.map((row) => upgradeStepSchema.parse(row));
  }

  /**
   * Registers each declared step as `pending` with its owner and description. A step already in
   * the ledger keeps its status, kind and mode; only its owner and description are refreshed.
   */
  async registerDeclaredSteps({
    steps,
  }: {
    steps: readonly DeclaredStep[];
  }): Promise<UpgradeStep[]> {
    if (steps.length === 0) return [];
    const parsed = steps.map((step) => declaredStepSchema.parse(step));
    const { rows } = await this.query<object>(
      (t) => `INSERT INTO ${t.step} AS step
              ("id", "kind", "mode", "owner", "description", "status", "inferred", "updated_at")
       SELECT source.id, source.kind, source.mode, source.owner, source.description,
              'pending', false, ${NOW_UTC}
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS source(id, kind, mode, owner, description)
       ON CONFLICT ("id") DO UPDATE
          SET "owner" = EXCLUDED."owner",
              "description" = EXCLUDED."description"
       RETURNING ${STEP_COLUMNS}`,
      [
        parsed.map((step) => step.id),
        parsed.map((step) => step.kind),
        parsed.map((step) => step.mode),
        parsed.map((step) => step.owner),
        parsed.map((step) => step.description),
      ],
    );
    return rows.map((row) => upgradeStepSchema.parse(row));
  }

  /** Records one target of a step; the same step and target again updates the row in place. */
  async upsertTarget({
    stepId,
    target,
    status,
    version = null,
    lastError = null,
  }: {
    stepId: string;
    target: string;
    status: UpgradeStepStatus;
    version?: string | null;
    lastError?: string | null;
  }): Promise<UpgradeTarget> {
    const { rows } = await this.query<object>(
      (t) => `INSERT INTO ${t.target}
              ("step_id", "target", "status", "version", "last_error", "updated_at")
       VALUES ($1, $2, $3, $4, $5, ${NOW_UTC})
       ON CONFLICT ("step_id", "target") DO UPDATE
          SET "status" = EXCLUDED."status",
              "version" = EXCLUDED."version",
              "last_error" = EXCLUDED."last_error",
              "updated_at" = EXCLUDED."updated_at"
       RETURNING ${TARGET_COLUMNS}`,
      [stepId, target, status, version, lastError],
    );
    return upgradeTargetSchema.parse(rows[0]);
  }

  async findTargets({ stepId }: { stepId: string }): Promise<UpgradeTarget[]> {
    const { rows } = await this.query<object>(
      (t) => `SELECT ${TARGET_COLUMNS} FROM ${t.target}
        WHERE "step_id" = $1 ORDER BY "target"`,
      [stepId],
    );
    return rows.map((row) => upgradeTargetSchema.parse(row));
  }

  /**
   * Takes the named lease when nobody holds it or the holder's has expired, in one statement, on
   * the database clock. Answers the lease, or null when a live holder keeps it.
   */
  async acquireLease({
    name,
    owner,
    image,
    host,
    ttlMs,
  }: {
    name: string;
    owner: string;
    image: string;
    host: string;
    ttlMs: number;
  }): Promise<UpgradeLease | null> {
    const { rows } = await this.query<object>(
      (t) => `INSERT INTO ${t.lease} AS lease
              ("name", "owner", "image", "host", "heartbeat_at", "expires_at")
       VALUES ($1, $2, $3, $4, ${NOW_UTC}, ${NOW_UTC} + ($5::double precision * interval '1 millisecond'))
       ON CONFLICT ("name") DO UPDATE
          SET "owner" = EXCLUDED."owner",
              "image" = EXCLUDED."image",
              "host" = EXCLUDED."host",
              "heartbeat_at" = EXCLUDED."heartbeat_at",
              "expires_at" = EXCLUDED."expires_at"
        WHERE lease."expires_at" < ${NOW_UTC}
       RETURNING ${LEASE_COLUMNS}`,
      [name, owner, image, host, ttlMs],
    );
    return rows[0] ? upgradeLeaseSchema.parse(rows[0]) : null;
  }

  /** Extends a lease its owner holds. Answers null when another owner holds it or none does. */
  async renewLease({
    name,
    owner,
    ttlMs,
  }: {
    name: string;
    owner: string;
    ttlMs: number;
  }): Promise<UpgradeLease | null> {
    const { rows } = await this.query<object>(
      (t) => `UPDATE ${t.lease}
          SET "heartbeat_at" = ${NOW_UTC},
              "expires_at" = ${NOW_UTC} + ($3::double precision * interval '1 millisecond')
        WHERE "name" = $1 AND "owner" = $2
       RETURNING ${LEASE_COLUMNS}`,
      [name, owner, ttlMs],
    );
    return rows[0] ? upgradeLeaseSchema.parse(rows[0]) : null;
  }

  /** Frees a lease its owner holds. Answers false when another owner holds it or none does. */
  async releaseLease({ name, owner }: { name: string; owner: string }): Promise<boolean> {
    const { rows } = await this.query<{ name: string }>(
      (t) => `DELETE FROM ${t.lease} WHERE "name" = $1 AND "owner" = $2 RETURNING "name"`,
      [name, owner],
    );
    return rows.length > 0;
  }

  /** Writes a serving process's roster entry; a refresh keeps the row's original start. */
  async writeRosterEntry({
    processId,
    role,
    image,
    release,
    steps,
  }: {
    processId: string;
    role: string;
    image: string;
    release: string | null;
    steps: readonly string[];
  }): Promise<ServingRosterEntry> {
    const { rows } = await this.query<object>(
      (t) => `INSERT INTO ${t.roster}
              ("process_id", "role", "image", "release", "steps", "started_at", "heartbeat_at")
       VALUES ($1, $2, $3, $4, $5::jsonb, ${NOW_UTC}, ${NOW_UTC})
       ON CONFLICT ("process_id") DO UPDATE
          SET "role" = EXCLUDED."role",
              "image" = EXCLUDED."image",
              "release" = EXCLUDED."release",
              "steps" = EXCLUDED."steps",
              "heartbeat_at" = EXCLUDED."heartbeat_at"
       RETURNING ${ROSTER_COLUMNS}`,
      [processId, role, image, release, JSON.stringify(steps)],
    );
    return servingRosterEntrySchema.parse(rows[0]);
  }

  /** Roster entries written within `staleAfterMs` of the database clock; an older one is dead. */
  async findLiveRoster({ staleAfterMs }: { staleAfterMs: number }): Promise<ServingRosterEntry[]> {
    const { rows } = await this.query<object>(
      (t) => `SELECT ${ROSTER_COLUMNS} FROM ${t.roster}
        WHERE "heartbeat_at" >= ${NOW_UTC} - ($1::double precision * interval '1 millisecond')
        ORDER BY "process_id"`,
      [staleAfterMs],
    );
    return rows.map((row) => servingRosterEntrySchema.parse(row));
  }

  /** Deletes a process's roster entry on a graceful stop; a missing row is not an error. */
  async removeRosterEntry({ processId }: { processId: string }): Promise<void> {
    await this.query((t) => `DELETE FROM ${t.roster} WHERE "process_id" = $1`, [processId]);
  }

  async findSteps(): Promise<UpgradeStep[]> {
    const { rows } = await this.query<object>(
      (t) => `SELECT ${STEP_COLUMNS} FROM ${t.step} ORDER BY "id"`,
    );
    return rows.map((row) => upgradeStepSchema.parse(row));
  }

  async findRuns(): Promise<UpgradeRun[]> {
    const { rows } = await this.query<object>(
      (t) => `SELECT ${RUN_COLUMNS} FROM ${t.run} ORDER BY "started_at", "id"`,
    );
    return rows.map((row) => upgradeRunSchema.parse(row));
  }
}
