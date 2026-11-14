/** Guards the app reader's tenant-table list against the schema the migrations build (ADR-202). */
import { describe, expect, it } from "vitest";

import type { PostgresNamedCollection } from "../../features/provisioning/services/langwatch-ql-postgres-mapping.service.ts";
import { APP_READER_TENANT_TABLES } from "../../rules/app-reader-access.rules.ts";
import { LangWatchQLAccessModelDefinitionService } from "../langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";
import { migratedTables } from "./support/clickhouse-migration-tables.ts";

const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "langwatch_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

const NAMED_COLLECTION: PostgresNamedCollection = {
  collection: "lwql_postgres",
  host: "pg.internal",
  port: 5432,
  database: "langwatch",
  user: "lwql_ro",
  password: "unused",
};

/** Column names that hold the owning tenant; a table with neither is unclassified. */
const TENANT_COLUMNS = ["TenantId", "project_id"] as const;

/** Tables the migrations leave that hold no tenant rows, each with why. None today. */
const TABLES_WITHOUT_TENANT: Readonly<Record<string, string>> = {};

const EVENTING_OWNS =
  "eventing reads its own log through its own surface (§7); slice 2 decides which identity it uses";

/** Tenant tables the app reader is never granted, so it reads none of their rows; each with why. */
const TABLES_NOT_GRANTED: Readonly<Record<string, string>> = {
  lwql_api_key_tenant_map:
    "KeyHash is the LangWatchQL capability's hash; ADR-200 keeps it to the LangWatchQL identity",
  event_log: EVENTING_OWNS,
  event_log_id_index: EVENTING_OWNS,
};

/** Engines that collapse rows sharing a sorting key, so `FINAL` must not span tenants. */
const COLLAPSING_ENGINE =
  /^(?:Replacing|Aggregating|Collapsing|VersionedCollapsing|Summing|Coalescing)MergeTree$/;

const ORGANISATION_METER =
  "organisation-keyed usage meter: TenantId sits inside the key, so FINAL collapses within one " +
  "tenant, but a TenantId-only read cannot prune on the primary key";

/** Collapsing tenant tables whose sorting key does not start with the tenant column. */
const SORTING_KEY_EXCEPTIONS: Readonly<Record<string, string>> = {
  billable_events: ORGANISATION_METER,
  log_usage_estimates: ORGANISATION_METER,
  metric_usage_estimates: ORGANISATION_METER,
  usage_trace_meter: ORGANISATION_METER,
};

function tenantColumnOf(columns: readonly string[]): string | undefined {
  return TENANT_COLUMNS.find((column) => columns.includes(column));
}

describe("given the ClickHouse migrations replayed into the tables they leave behind", () => {
  const tables = [...migratedTables().values()];
  const policed = new Map(APP_READER_TENANT_TABLES.map((t) => [t.table, t.tenantColumn]));

  it("reads the schema rather than an empty directory", () => {
    expect(tables.length).toBeGreaterThan(50);
    expect(tables.find((t) => t.name === "stored_spans")?.sortingKey[0]).toBe("TenantId");
  });

  /** @scenario "Every table the migrations leave with a tenant column has an app reader policy" */
  it("polices every tenant table on its tenant column and classifies the rest", () => {
    const unpoliced = tables
      .filter((t) => {
        const column = tenantColumnOf(t.columns);
        if (!column) return !(t.name in TABLES_WITHOUT_TENANT);
        return t.name in TABLES_NOT_GRANTED ? false : policed.get(t.name) !== column;
      })
      .map((t) => `${t.name} (${t.migration}): ${tenantColumnOf(t.columns) ?? "no tenant column"}`);
    expect(unpoliced, "add each table to APP_READER_TENANT_TABLES or classify it").toEqual([]);

    const classified = [...Object.keys(TABLES_WITHOUT_TENANT), ...Object.keys(TABLES_NOT_GRANTED)];
    const live = new Set(tables.map((t) => t.name));
    const stale = [...policed.keys(), ...classified].filter((name) => !live.has(name));
    expect(stale, "the migrations no longer leave these tables").toEqual([]);
  });

  /** @scenario "The app reader is never granted the LangWatchQL key map or eventing's log" */
  it("grants the reader no table it is classified as never granted", () => {
    const withTenantColumn = tables.filter((t) => tenantColumnOf(t.columns)).map((t) => t.name);
    expect(
      Object.keys(TABLES_NOT_GRANTED).filter((name) => !withTenantColumn.includes(name)),
    ).toEqual([]);
    expect([...policed.keys()].filter((name) => name in TABLES_NOT_GRANTED)).toEqual([]);
    const reader = accessModelDefinition.build({
      names: NAMES,
      passwordSha256Hex: "a".repeat(64),
      namedCollection: NAMED_COLLECTION,
      sourceDatabase: NAMES.database,
      appReader: { passwordSha256Hex: "b".repeat(64) },
    }).appReader;
    const reached = [...(reader?.grants ?? []), ...(reader?.rowPolicies ?? [])].map((t) => t.table);
    expect(reader?.grants.length).toBeGreaterThan(50);
    expect(reached.filter((table) => table in TABLES_NOT_GRANTED)).toEqual([]);
  });

  /** @scenario "Every deduplicating tenant table leads its sorting key with its tenant column" */
  it("leads every collapsing tenant table's sorting key with its tenant column", () => {
    const collapsing = tables.filter(
      (t) => COLLAPSING_ENGINE.test(t.engine) && tenantColumnOf(t.columns),
    );
    expect(collapsing.length).toBeGreaterThan(40);
    const offenders = collapsing
      .filter((t) => t.sortingKey[0] !== tenantColumnOf(t.columns))
      .map((t) => t.name);
    expect(offenders.toSorted()).toEqual(Object.keys(SORTING_KEY_EXCEPTIONS).toSorted());

    const keyless = collapsing
      .filter((t) => t.name in SORTING_KEY_EXCEPTIONS)
      .filter((t) => !t.sortingKey.includes(tenantColumnOf(t.columns) ?? ""))
      .map((t) => t.name);
    expect(keyless, "an exception still needs its tenant column inside the key").toEqual([]);
  });
});
