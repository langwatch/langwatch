import { createClient } from "@clickhouse/client";
import type { LangWatchQLResourceLimits } from "@langwatch/analytics-contract/langwatch-ql-limits";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCapabilityService } from "../../services/langwatch-ql-capability.service.ts";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  type LangWatchQLClickHouseHarness,
  selectRows,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();
const capabilities = LangWatchQLCapabilityService.create();

export const SEED_BUDGET_SECONDS = 300;

/** The views the three queries read. Only these are provisioned: none of them maps Postgres. */
const READ_VIEWS = new Set(["traces", "trace_metrics", "trace_evaluation_metrics"]);
export const VIEWS = LWQL_VIEW_CATALOG.filter((view) => READ_VIEWS.has(view.name));

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 60;
const HISTORY_DAYS = 300;
const PERIOD_END = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const PERIOD_START = PERIOD_END - PERIOD_DAYS * DAY_MS;
/** The window before the period, which every one of the three also reads. */
const READ_START = PERIOD_START - PERIOD_DAYS * DAY_MS;
const READ_MS = PERIOD_END - READ_START;
const HISTORY_MS = HISTORY_DAYS * DAY_MS;

/** As a board sends them: instants, which the executor binds as Unix seconds. */
export const PARAMETERS = {
  dashboard_context_period_start: new Date(PERIOD_START).toISOString(),
  dashboard_context_period_end: new Date(PERIOD_END).toISOString(),
  dashboard_context_granularity_seconds: 86_400,
  dashboard_context_sources: ["application"],
};

const UNITS = 2_000;
const MANAGED_VERSIONS = 20;
const METADATA_VERSIONS = 10;
const EVALUATORS = 5;
/** With CustomerId and Labels, the 8 keys att-change and att-table pick their unit from. */
const UNIT_METADATA_KEYS = ["document_type", "language", "team", "flow", "segment", "topic"];

export type TenantName = "SMALL" | "LARGE" | "BARE" | "HISTORY_1500K" | "HISTORY_4000K";
export type TenantSeed = {
  name: TenantName;
  tenantId: string;
  keyHash: string;
  /** Traces inside the 120 days read. */
  windowTraces: number;
  /** Traces in the 300 days before them. */
  historyTraces: number;
  /** Whether its traces carry evaluations, which att-change never reads. */
  evaluations: boolean;
};

type TenantSize = Pick<TenantSeed, "name" | "windowTraces" | "historyTraces"> & {
  evaluations?: boolean;
};

function tenantSeed({
  name,
  windowTraces,
  historyTraces,
  evaluations = true,
}: TenantSize): TenantSeed {
  const tenantId = `attribution-${name.toLowerCase()}`;
  const keyHash = capabilities.tenantCapability({ secret: `raw-lwql-key-${tenantId}-DO-NOT-LOG` });
  return { name, tenantId, keyHash, windowTraces, historyTraces, evaluations };
}

export const TENANTS: Record<TenantName, TenantSeed> = {
  SMALL: tenantSeed({ name: "SMALL", windowTraces: 125_000, historyTraces: 190_000 }),
  LARGE: tenantSeed({ name: "LARGE", windowTraces: 250_000, historyTraces: 375_000 }),
  BARE: tenantSeed({ name: "BARE", windowTraces: 250_000, historyTraces: 0 }),
  HISTORY_1500K: tenantSeed({
    name: "HISTORY_1500K",
    windowTraces: 250_000,
    historyTraces: 1_500_000,
    evaluations: false,
  }),
  HISTORY_4000K: tenantSeed({
    name: "HISTORY_4000K",
    windowTraces: 250_000,
    historyTraces: 4_000_000,
    evaluations: false,
  }),
};

/** Seeded on every run. */
export const PERMANENT_TENANTS = [TENANTS.SMALL, TENANTS.LARGE, TENANTS.BARE];
/** The sweep's history sizes, smallest first, its window fixed at 250k traces. */
export const SWEEP_TENANTS = [
  TENANTS.BARE,
  TENANTS.LARGE,
  TENANTS.HISTORY_1500K,
  TENANTS.HISTORY_4000K,
];
/** What the sweep seeds on top of the permanent tenants. */
export const SWEEP_ONLY_TENANTS = [TENANTS.HISTORY_1500K, TENANTS.HISTORY_4000K];

/**
 * The seed writes whole blocks: merges stay stopped on these tables, so each block is a part per
 * week it spans, and small blocks would pile parts up until inserts are throttled.
 */
const SEED_SETTINGS = {
  max_insert_threads: "1",
  min_insert_block_size_rows: "262144",
  min_insert_block_size_bytes: "0",
} as const;

/**
 * Trace t of a tenant: the first `windowTraces` spread evenly over the 120 days read, the rest
 * over the 300 days before them. 30% carry a managed version, 10% a metadata version.
 */
function seedTraces({ tenant }: { tenant: TenantSeed }): string {
  const { windowTraces: inWindow, historyTraces } = tenant;
  return `(
    SELECT number AS t,
      lower(hex(MD5(concat({tenantId:String}, '-', toString(t))))) AS tid,
      if(t < ${inWindow},
        toDateTime64({end:DateTime64(3)}, 3) - toIntervalMillisecond(intDiv(t * ${READ_MS}, ${inWindow}) + 1),
        toDateTime64({readStart:DateTime64(3)}, 3)
          - toIntervalMillisecond(intDiv(greatest(toInt64(t) - ${inWindow}, 0) * ${HISTORY_MS}, ${Math.max(historyTraces, 1)}) + 1)) AS occ,
      t % ${UNITS} AS unit,
      if(t % 10 < 3, concat('pv-', toString(intDiv(t, 10) % ${MANAGED_VERSIONS})), '') AS managed,
      if(t % 10 = 3, concat('m-', toString(intDiv(t, 10) % ${METADATA_VERSIONS})), '') AS metadata_version
    FROM numbers(${inWindow + historyTraces})
  )`;
}

/** Rows older than the 308-day TTL would go at the next merge; 0 keeps the 300 days of history. */
const KEEP = 0;
const unitValue = (key: string) => `concat('${key}-', toString(unit))`;

/** The tenant's `trace_analytics` rows, the managed version in `LastUsedPromptVersionId`. */
function traceAnalyticsInsert({ facts, tenant }: { facts: string; tenant: TenantSeed }): string {
  const metadata = UNIT_METADATA_KEYS.map((key) => `'metadata.${key}', ${unitValue(key)}`);
  return `
    INSERT INTO ${facts}.trace_analytics (TenantId, TraceId, Version, OccurredAt, CreatedAt, UpdatedAt, TraceName, CustomerId, Origin, Models, Labels, TotalDurationMs, HasError, Attributes, MetadataPromptVersion, _retention_days, LastUsedPromptVersionId)
    SELECT {tenantId:String}, tid, '1', occ, occ, occ, concat('agent-', toString(t % 40)),
      ${unitValue("customer")}, 'application', ['gpt-5-mini'], [${unitValue("label")}], (t * 13) % 60000, false,
      map('langwatch.origin', 'application', ${metadata.join(", ")}),
      metadata_version, ${KEEP}, managed
    FROM ${seedTraces({ tenant })}
  `;
}

function traceSummariesInsert({ facts, tenant }: { facts: string; tenant: TenantSeed }): string {
  return `
    INSERT INTO ${facts}.trace_summaries (ProjectionId, TenantId, TraceId, Version, OccurredAt, CreatedAt, UpdatedAt, TraceName, Attributes, LastUsedPromptVersionId, _retention_days)
    SELECT tid, {tenantId:String}, tid, '1', occ, occ, occ, concat('agent-', toString(t % 40)),
      map('langwatch.origin', 'application', 'langwatch.customer_id', ${unitValue("customer")}),
      nullIf(managed, ''), ${KEEP}
    FROM ${seedTraces({ tenant })}
  `;
}

/**
 * Two evaluations a trace. Every tenth trace's first one changed: its first row, the retraction of
 * that row and its next revision land as three inserts, so the pair stays unmerged (ADR-007).
 */
const EVALUATION_WRITES = [
  { sign: 1, revision: 1, only: "1" },
  { sign: -1, revision: 1, only: "t % 10 = 0 AND n = 0" },
  { sign: 1, revision: 2, only: "t % 10 = 0 AND n = 0" },
] as const;

function traceEvaluationInsert({
  facts,
  tenant,
  write,
}: {
  facts: string;
  tenant: TenantSeed;
  write: (typeof EVALUATION_WRITES)[number];
}): string {
  const passedFirst = `(t + n) % 3 != 0`;
  const metadata = UNIT_METADATA_KEYS.map((key) => unitValue(key));
  return `
    INSERT INTO ${facts}.trace_evaluation_analytics (TenantId, TraceId, EvaluationId, OccurredAt, UpdatedAt, TraceOccurredAt, EvaluatorName, Status, IsGuardrail, Passed, Origin, TraceOrigin, CustomerId, Labels, MetadataDocumentType, MetadataLanguage, MetadataTeam, MetadataFlow, MetadataSegment, MetadataTopic, MetadataPromptVersion, Sign, Revision, _retention_days)
    SELECT {tenantId:String}, tid, concat(tid, '-', toString(n)),
      occ + toIntervalMinute(1 + n), occ + toIntervalMinute(1 + n) + toIntervalHour(${write.revision - 1}), occ,
      concat('evaluator-', toString((t + n) % ${EVALUATORS})), 'processed', false,
      ${write.revision === 1 ? passedFirst : `NOT (${passedFirst})`},
      'application', 'application', ${unitValue("customer")}, [${unitValue("label")}],
      ${metadata.join(", ")}, metadata_version, ${write.sign}, ${write.revision}, ${KEEP}
    FROM ${seedTraces({ tenant })}
    ARRAY JOIN [0, 1] AS n
    WHERE ${write.only}
  `;
}

/** Provisions the views and the access model with `limits`, and maps every tenant's key. */
export async function provisionAttributionViews({
  harness,
  limits,
}: {
  harness: LangWatchQLClickHouseHarness;
  limits: LangWatchQLResourceLimits;
}): Promise<void> {
  const { names, factDatabase: facts } = harness;
  await harness.applyAsAdmin(
    viewProvisioning.setupStatements({
      names,
      sourceDatabase: facts,
      views: VIEWS,
      dedup: SHIPPED_LWQL_DEDUP,
    }),
  );
  await harness.applyAccessModel({ views: VIEWS, sourceDatabase: facts, limits });
  // The harness stops merges on the trace tables; the pairs must stay unmerged here too.
  await harness.applyAsAdmin([
    `SYSTEM STOP MERGES ${facts}.trace_evaluation_analytics`,
    `TRUNCATE TABLE ${facts}.trace_evaluation_analytics`,
  ]);
  await harness.admin.insert({
    table: `${facts}.${names.keyMapTable}`,
    format: "JSONEachRow",
    values: Object.values(TENANTS).map(({ keyHash, tenantId }) => ({
      KeyHash: keyHash,
      TenantId: tenantId,
    })),
  });
}

/** The statements that write one tenant's traces, its evaluations only when it carries them. */
function tenantStatements({ facts, tenant }: { facts: string; tenant: TenantSeed }): string[] {
  const evaluations = tenant.evaluations
    ? EVALUATION_WRITES.map((write) => traceEvaluationInsert({ facts, tenant, write }))
    : [];
  return [
    traceAnalyticsInsert({ facts, tenant }),
    traceSummariesInsert({ facts, tenant }),
    ...evaluations,
  ];
}

/** Seeds `tenants` once the views are provisioned, checks their row counts, returns the seconds. */
export async function seedAttributionTenants({
  harness,
  tenants,
}: {
  harness: LangWatchQLClickHouseHarness;
  tenants: readonly TenantSeed[];
}): Promise<number> {
  const facts = harness.factDatabase;
  // One INSERT ... SELECT can outlast the driver's default 30 s on a slow runner.
  const seeder = createClient({
    url: harness.container.getHttpUrl(),
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
    request_timeout: SEED_BUDGET_SECONDS * 1000,
  });
  const seedStartedAt = performance.now();
  for (const tenant of tenants) {
    for (const query of tenantStatements({ facts, tenant })) {
      await seeder.command({
        query,
        query_params: {
          tenantId: tenant.tenantId,
          end: new Date(PERIOD_END).toISOString().slice(0, 23).replace("T", " "),
          readStart: new Date(READ_START).toISOString().slice(0, 23).replace("T", " "),
        },
        clickhouse_settings: SEED_SETTINGS,
      });
    }
  }
  const seedSeconds = (performance.now() - seedStartedAt) / 1000;
  await seeder.close();

  const seeded = await selectRows<{ TenantId: string; n: string }>(
    harness.admin,
    `SELECT TenantId, count() AS n FROM ${facts}.trace_analytics ` +
      `WHERE TenantId LIKE 'attribution-%' GROUP BY TenantId`,
  );
  for (const tenant of tenants) {
    const n = Number(seeded.find((row) => row.TenantId === tenant.tenantId)?.n);
    if (n !== tenant.windowTraces + tenant.historyTraces) {
      throw new Error(`seed wrote ${n} trace_analytics rows for ${tenant.name}`);
    }
  }
  return seedSeconds;
}
