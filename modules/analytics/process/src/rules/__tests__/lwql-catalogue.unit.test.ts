/**
 * The catalogue machinery: completeness is a compile error (each `@ts-expect-error` below fails
 * the typecheck if its call ever compiles), and the traces exemplar matches today's view.
 * @see specs/lwql/catalogue-grants.feature
 */

import { assertType, describe, expect, it } from "vitest";

import {
  defineTableCatalogue,
  exposedCatalogueColumns,
  LWQL_TRACES_CATALOGUE,
} from "../lwql-catalogue.rules.ts";
import { pickLwqlViewByName } from "../lwql-view-catalog.rules.ts";

const ACCESS = { allOf: ["analytics:view", "traces:view"] } as const;

describe("given a catalogue table", () => {
  it("compiles when every source column has an entry", () => {
    const table = defineTableCatalogue({
      sourceTable: "coding_agent_trace_sessions",
      access: ACCESS,
      columns: {
        TenantId: "inherit",
        TraceId: "inherit",
        Session: { source: "SessionId", access: { anyOf: ["cost:view", "traces:share"] } },
        OccurredAt: "inherit",
        UpdatedAt: "omit",
        _retention_days: "omit",
      },
    });
    expect(exposedCatalogueColumns({ table }).map((column) => column.name)).toEqual([
      "TenantId",
      "TraceId",
      "Session",
      "OccurredAt",
    ]);
  });

  /** @scenario "A table without access does not compile" */
  it("refuses a table that declares no access", () => {
    assertType(
      // @ts-expect-error `access` is required
      defineTableCatalogue({
        sourceTable: "lwql_api_key_tenant_map",
        columns: { KeyHash: "inherit", TenantId: "inherit" },
      }),
    );
  });

  /** @scenario "An empty or unknown permission list does not compile" */
  it("refuses an empty or unknown permission list", () => {
    assertType(
      defineTableCatalogue({
        sourceTable: "lwql_api_key_tenant_map",
        // @ts-expect-error an empty allOf would grant everyone
        access: { allOf: [] },
        columns: { KeyHash: "inherit", TenantId: "inherit" },
      }),
    );
    assertType(
      defineTableCatalogue({
        sourceTable: "lwql_api_key_tenant_map",
        // @ts-expect-error not a registry permission
        access: { allOf: ["traces:rotate"] },
        columns: { KeyHash: "inherit", TenantId: "inherit" },
      }),
    );
  });

  /** @scenario "A source column with no entry does not compile" */
  it("refuses a table that leaves a source column out", () => {
    assertType(
      defineTableCatalogue({
        sourceTable: "lwql_api_key_tenant_map",
        access: ACCESS,
        // @ts-expect-error `TenantId` has no entry
        columns: { KeyHash: "inherit" },
      }),
    );
  });

  /** @scenario "An exposed name the source lacks must name its source" */
  it("refuses a name the source lacks unless it names its source", () => {
    assertType(
      defineTableCatalogue({
        sourceTable: "lwql_api_key_tenant_map",
        access: ACCESS,
        columns: {
          KeyHash: "inherit",
          TenantId: "inherit",
          // @ts-expect-error `Tenant` is not a column of the source
          Tenant: "inherit",
        },
      }),
    );
    assertType(
      defineTableCatalogue({
        sourceTable: "lwql_api_key_tenant_map",
        access: ACCESS,
        columns: {
          // @ts-expect-error a source column's own name takes no `source`
          KeyHash: { source: "TenantId" },
          TenantId: "inherit",
        },
      }),
    );
  });

  /** @scenario "A column cannot be exposed from an omitted column" */
  it("refuses a column read from an omitted column", () => {
    assertType(
      defineTableCatalogue({
        sourceTable: "lwql_api_key_tenant_map",
        access: ACCESS,
        columns: {
          KeyHash: "inherit",
          TenantId: "omit",
          // @ts-expect-error `TenantId` is omitted
          Tenant: { source: "TenantId" },
        },
      }),
    );
  });
});

describe("given the traces exemplar", () => {
  const view = pickLwqlViewByName("traces");
  const exposed = exposedCatalogueColumns({ table: LWQL_TRACES_CATALOGUE });

  /** @scenario "A renamed column reads its declared source" */
  it("reads each renamed column from its declared source", () => {
    expect(exposed.filter((column) => column.name !== column.source)).toEqual([
      { name: "CapturedInput", source: "ComputedInput", content: "input" },
      { name: "CapturedOutput", source: "ComputedOutput", content: "output" },
    ]);
  });

  /** @scenario "An omitted column is exposed nowhere" */
  it("exposes no omitted column, and today's traces view reads none", () => {
    const omitted = Object.entries(LWQL_TRACES_CATALOGUE.columns)
      .filter(([, entry]) => entry === "omit")
      .map(([name]) => name);
    const read = [
      ...exposed.flatMap((column) => [column.name, column.source]),
      ...(view?.columns.flatMap((column) => column.sourceColumns) ?? []),
    ];
    expect(omitted).toContain("ErrorMessage");
    expect(read.filter((name) => omitted.includes(name))).toEqual([]);
  });

  it("exposes today's traces view columns with their gates as access and content", () => {
    const today = (view?.columns ?? []).map((column) => ({
      name: column.name,
      source: column.sourceColumns[0],
      ...(column.gates.includes("costs") ? { access: { allOf: ["cost:view"] } } : {}),
      ...(column.gates.includes("input") ? { content: "input" } : {}),
      ...(column.gates.includes("output") ? { content: "output" } : {}),
    }));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect(LWQL_TRACES_CATALOGUE.sourceTable).toBe(view?.sourceTable);
    expect(exposed.toSorted(byName)).toEqual(today.toSorted(byName));
  });
});
