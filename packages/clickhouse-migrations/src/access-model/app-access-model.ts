/**
 * The application's ClickHouse identities (ADR-202): the restricted reader its row policies bind,
 * the shadow sampler's enforcing reader, and the api's insert-only writer. Their names, settings,
 * every tenant table the policies bound, and the statements that provision them on a server.
 * @see specs/clickhouse/app-reader-row-policies.feature
 */
import { TENANT_IDS_SETTING, TENANT_SETTING_PREFIX } from "@langwatch/clickhouse-client";

import {
  type AccessGrant,
  type AccessIdentity,
  type AccessProfileSetting,
  type AccessRowPolicy,
  assertAccessIdentifier,
  renderIdentitiesUsersD,
  renderIdentityDdl,
} from "./access-identity.ts";

/** Names of the app reader's ClickHouse objects; its settings are the client's own. */
export const APP_READER_NAMES = {
  user: "langwatch_app_reader",
  settingsProfile: "langwatch_app_reader_profile",
  /** Comma-separated tenant ids a read may see; the client sets it per request. */
  tenantSetting: TENANT_IDS_SETTING,
  /** 0 in shadow (every row visible), 1 when enforcing; pinned `CONST` in the profile. */
  enforceSetting: `${TENANT_SETTING_PREFIX}tenancy_enforce`,
} as const;

/** The `custom_settings_prefixes` entry the server must declare for the reader's settings. */
export const APP_READER_SETTINGS_PREFIX = "SQL_";

/** The shadow sampler's identity (ADR-202 Rollout 3), named after the app reader it checks. */
export const APP_READER_ENFORCING_NAMES = {
  user: `${APP_READER_NAMES.user}_enforcing`,
  settingsProfile: `${APP_READER_NAMES.user}_enforcing_profile`,
} as const;

/** The api's insert-only writer (ADR-202 Decided 12), named beside the app reader. */
export const APP_WRITER_NAMES = {
  user: "langwatch_app_writer",
  settingsProfile: "langwatch_app_writer_profile",
} as const;

/**
 * The tables the api's three inserts write, and nothing else: the governance OTLP spend debit,
 * `POST /api/dspy/log_steps` and the instant-eval run create. Two feed views, which on 26.8 run
 * as their definer so the writer needs no SELECT (ADR-202 Decided 16).
 */
export const APP_WRITER_TABLES: readonly string[] = [
  "gateway_budget_ledger_events",
  "dspy_steps",
  "instant_eval_runs",
];

/** A tenant table and the column naming its owning tenant. */
export interface AppReaderTenantTable {
  readonly table: string;
  readonly tenantColumn: string;
}

/**
 * Tenant tables keyed on `TenantId`, as the ClickHouse migrations leave them. The LangWatchQL key
 * map and eventing's log are never granted to the reader; the guard test names them with why.
 */
const TENANT_ID_TABLES = [
  "automation_audit",
  "billable_events",
  "coding_agent_session_events",
  "coding_agent_session_events_id_index",
  "coding_agent_sessions",
  "coding_agent_sessions_id_index",
  "coding_agent_trace_sessions",
  "coding_agent_trace_sessions_id_index",
  "dspy_steps",
  "dspy_steps_id_index",
  "evaluation_analytics",
  "evaluation_analytics_id_index",
  "evaluation_analytics_rollup",
  "evaluation_runs",
  "evaluation_runs_by_trace_id_index",
  "evaluation_runs_id_index",
  "experiment_run_items",
  "experiment_runs",
  "experiment_runs_by_experiment_id_index",
  "experiment_runs_id_index",
  "gateway_budget_ledger_events",
  "gateway_budget_ledger_events_id_index",
  "gateway_budget_scope_totals",
  "gateway_spend",
  "gateway_spend_id_index",
  "governance_cost_rollup_1d",
  "governance_cost_rollup_charges",
  "governance_cost_rollup_restatement_index",
  "governance_kpis",
  "governance_ocsf_events",
  "instant_eval_judgments",
  "instant_eval_runs",
  "langy_analytics_events",
  "langy_messages",
  "log_records",
  "log_usage_estimates",
  "metric_data_points",
  "metric_series",
  "metric_time_rollups",
  "metric_usage_estimates",
  "session_metric_series",
  "simulation_run_metrics",
  "simulation_run_metrics_rollup",
  "simulation_runs",
  "simulation_runs_by_batch_run_id_index",
  "simulation_runs_by_scenario_set_id_index",
  "simulation_runs_id_index",
  "span_analytics",
  "stored_log_records",
  "stored_metric_records",
  "stored_spans",
  "stored_spans_id_index",
  "suite_runs",
  "suite_runs_id_index",
  "trace_analytics",
  "trace_analytics_id_index",
  "trace_analytics_rollup",
  "trace_evaluation_analytics",
  "trace_summaries",
  "trace_summaries_id_index",
  "usage_trace_meter",
] as const;

/**
 * Every table holding tenant rows, in the application's database. A table missing here is not
 * granted, so the reader cannot read it; a guard test replays the migrations and fails on any
 * tenant table neither listed nor excluded with a reason.
 */
export const APP_READER_TENANT_TABLES: readonly AppReaderTenantTable[] = [
  ...TENANT_ID_TABLES.map((table) => ({ table, tenantColumn: "TenantId" })),
  { table: "stored_objects", tenantColumn: "project_id" },
];

/**
 * System tables 26.8 grants every user implicitly, which `REVOKE` does not remove. Every tenant
 * shares the app reader and the LangWatchQL user, so a policy admitting no row hides each one
 * from both (ADR-202).
 */
export const HIDDEN_SYSTEM_TABLES: readonly { database: string; table: string }[] = [
  { database: "system", table: "user_query_log" },
];

/**
 * The server-metadata tables a reader may read with no tenant setting (ADR-202 Decided 3): the
 * builder's `SERVER_METADATA_TABLES`, and nothing else. query_log, processes and mutations stay
 * refused (app-reader-identity.integration.test.ts proves both on 26.8).
 */
const APP_READER_SERVER_METADATA_GRANTS: readonly AccessGrant[] = [
  { database: "system", table: "columns" },
  { database: "system", table: "replicas" },
  { database: "system", table: "server_settings" },
];

/**
 * Every row while the profile pins enforce to 0 (shadow), else rows of a non-empty id in the
 * request's set; `toString` reads a string or a number alike. `has` over the constant array
 * prunes the primary key on 26.8, `IN` not.
 */
function appReaderTenantPredicate({ tenantColumn }: { tenantColumn: string }): string {
  const enforceSetting = assertAccessIdentifier({
    value: APP_READER_NAMES.enforceSetting,
    role: "enforceSetting",
  });
  const tenantSetting = assertAccessIdentifier({
    value: APP_READER_NAMES.tenantSetting,
    role: "tenantSetting",
  });
  const column = assertAccessIdentifier({ value: tenantColumn, role: "tenantColumn" });
  return (
    `toString(getSetting('${enforceSetting}')) = '0' OR ` +
    `has(arrayFilter(tenant -> notEmpty(tenant), splitByChar(',', getSetting('${tenantSetting}'))), ` +
    `${column})`
  );
}

/** A policy name per table and identity, so no identity's policy replaces another's. */
function policyNameOf({ suffix }: { suffix: string }): (table: string) => string {
  return (table) => `${assertAccessIdentifier({ value: table, role: "table" })}_${suffix}`;
}

/**
 * A policy admitting no row on each system table every user is granted implicitly (ADR-202), for
 * each identity a tenant shares: the app's and LangWatchQL's, through this one path (Decided 5).
 */
export function hiddenSystemTablePolicies({
  policyName,
}: {
  policyName: (table: string) => string;
}): AccessRowPolicy[] {
  return HIDDEN_SYSTEM_TABLES.map(({ database, table }) => ({
    name: policyName(table),
    database,
    table,
    predicate: "0",
  }));
}

/**
 * The reader's tenant set starts empty and stays the client's to set; the enforce switch, the
 * query cache and introspection are `CONST`. The condition cache stays on (ADR-202 Decided 10):
 * app-reader-identity.integration.test.ts proves it keeps tenants apart on 26.8.
 */
function appReaderProfileSettings({ enforce }: { enforce: boolean }): AccessProfileSetting[] {
  return [
    {
      name: APP_READER_NAMES.tenantSetting,
      value: "",
      quoted: true,
      constraint: "changeable_in_readonly",
    },
    {
      name: APP_READER_NAMES.enforceSetting,
      value: enforce ? "1" : "0",
      quoted: true,
      constraint: "const",
    },
    { name: "use_query_cache", value: 0, constraint: "const" },
    { name: "allow_introspection_functions", value: 0, constraint: "const" },
  ];
}

/** The writer reads nothing, so nothing is the client's to set; caches and introspection off. */
function appWriterProfileSettings(): AccessProfileSetting[] {
  return [
    { name: "use_query_cache", value: 0, constraint: "const" },
    { name: "allow_introspection_functions", value: 0, constraint: "const" },
  ];
}

function tenantReader({
  names,
  passwordSha256Hex,
  enforce,
  sourceDatabase,
  policyName,
  hiddenPolicyName,
}: {
  names: { readonly user: string; readonly settingsProfile: string };
  passwordSha256Hex: string;
  enforce: boolean;
  sourceDatabase: string;
  policyName: (table: string) => string;
  hiddenPolicyName: (table: string) => string;
}): AccessIdentity {
  return {
    user: { name: names.user, passwordSha256Hex },
    profile: { name: names.settingsProfile, settings: appReaderProfileSettings({ enforce }) },
    grants: [
      ...APP_READER_TENANT_TABLES.map(({ table }) => ({ database: sourceDatabase, table })),
      ...APP_READER_SERVER_METADATA_GRANTS,
    ],
    rowPolicies: [
      ...APP_READER_TENANT_TABLES.map(({ table, tenantColumn }) => ({
        name: policyName(table),
        database: sourceDatabase,
        table,
        predicate: appReaderTenantPredicate({ tenantColumn }),
      })),
      ...hiddenSystemTablePolicies({ policyName: hiddenPolicyName }),
    ],
  };
}

/**
 * SELECT on, and one tenant policy over, each tenant table; no other grant. A policy admitting no
 * row hides each implicitly granted system table. A SQL policy is named per table, not per user.
 */
export function appReaderIdentity({
  passwordSha256Hex,
  enforce = false,
  sourceDatabase,
}: {
  passwordSha256Hex: string;
  enforce?: boolean;
  sourceDatabase: string;
}): AccessIdentity {
  return tenantReader({
    names: APP_READER_NAMES,
    passwordSha256Hex,
    enforce,
    sourceDatabase,
    policyName: policyNameOf({ suffix: "app_tenant" }),
    hiddenPolicyName: policyNameOf({ suffix: "app_hidden" }),
  });
}

/** The app reader's grants and policies under its own names, enforce pinned on. */
export function appReaderEnforcingIdentity({
  passwordSha256Hex,
  sourceDatabase,
}: {
  passwordSha256Hex: string;
  sourceDatabase: string;
}): AccessIdentity {
  return tenantReader({
    names: APP_READER_ENFORCING_NAMES,
    passwordSha256Hex,
    enforce: true,
    sourceDatabase,
    policyName: policyNameOf({ suffix: "app_enforcing_tenant" }),
    hiddenPolicyName: policyNameOf({ suffix: "app_enforcing_hidden" }),
  });
}

/** The writer's input to the emitters: its credential hash alone. */
export interface AppWriterInput {
  readonly passwordSha256Hex: string;
}

/**
 * INSERT on each of the api's three tables and no other grant; the implicitly granted system
 * tables hidden by a policy admitting no row, so the writer reads nothing at all.
 */
export function appWriterIdentity({
  passwordSha256Hex,
  sourceDatabase,
}: {
  passwordSha256Hex: string;
  sourceDatabase: string;
}): AccessIdentity {
  return {
    user: { name: APP_WRITER_NAMES.user, passwordSha256Hex },
    profile: { name: APP_WRITER_NAMES.settingsProfile, settings: appWriterProfileSettings() },
    grants: APP_WRITER_TABLES.map((table) => ({
      database: sourceDatabase,
      table,
      privilege: "INSERT" as const,
    })),
    rowPolicies: hiddenSystemTablePolicies({
      policyName: policyNameOf({ suffix: "app_writer_hidden" }),
    }),
  };
}

/** The app's identities on one server: the reader's hashes and switch, the writer's when held. */
export interface AppAccessModelInput {
  sourceDatabase: string;
  /** `enforce` defaults to shadow (ADR-202 Rollout); `enforcing` adds the sampler's reader. */
  appReader: {
    passwordSha256Hex: string;
    enforce?: boolean;
    enforcing?: { passwordSha256Hex: string };
  };
  appWriter?: AppWriterInput | undefined;
}

/** The reader, its enforcing twin and the writer, in the order both emitters render them. */
function appAccessIdentities({
  sourceDatabase,
  appReader,
  appWriter,
}: AppAccessModelInput): AccessIdentity[] {
  return [
    appReaderIdentity({ ...appReader, sourceDatabase }),
    ...(appReader.enforcing
      ? [appReaderEnforcingIdentity({ ...appReader.enforcing, sourceDatabase })]
      : []),
    ...(appWriter ? [appWriterIdentity({ ...appWriter, sourceDatabase })] : []),
  ];
}

/**
 * The app's identities as DDL for a SQL access store: what every target needs, LangWatchQL
 * provisioned there or not (ADR-202 Decided 6, 12).
 */
export function renderAppReaderDdl(input: AppAccessModelInput): string[] {
  assertAccessIdentifier({ value: input.sourceDatabase, role: "database" });
  return appAccessIdentities(input).flatMap((identity) => renderIdentityDdl({ identity }));
}

/** The app's identities as users.d, for a config store without LangWatchQL (ADR-202 Decided 6). */
export function renderAppReaderUsersD(input: AppAccessModelInput): string {
  assertAccessIdentifier({ value: input.sourceDatabase, role: "database" });
  return renderIdentitiesUsersD({
    identities: appAccessIdentities(input),
    customSettingsPrefixes: [APP_READER_SETTINGS_PREFIX],
  });
}
