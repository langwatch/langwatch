/**
 * The write choke point: what a saved chart has to survive before it becomes a
 * row, and the fact that a refused one never becomes one at all.
 *
 * The store is an in-memory fake rather than a mock because the claim under
 * test is "nothing was written", which is a fact about the store's contents —
 * an artifact to read, not a call sequence to verify. The LangWatchQL service
 * is the real one, built with no executor: validation needs no database, and a
 * stubbed validator would prove only that the stub refuses.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";
import { VEGA_LITE_SCHEMA_URL } from "~/features/analytics-query/visualization/vegaLiteSchema";
import type { CustomGraph } from "~/generated/prisma/client";

import type { Protections } from "../../../traces/protections";
import { WORKBENCH_SQL_CHART_KIND } from "../../chartKinds";
import { LangWatchQLService } from "../../lwql/lwql.service";
import type {
  CreateSavedWorkbenchChartInput,
  SavedWorkbenchChartStore,
  UpdateSavedWorkbenchChartInput,
} from "../savedWorkbenchChart.repository";
import { SavedWorkbenchChartService } from "../savedWorkbenchChart.service";
import { WORKBENCH_CHART_DEFINITION_VERSION } from "../workbenchChartDefinition";

const PROJECT_ID = "project-under-test";

/** Everything visible: the author the gate is measured against. */
const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/** No captured content — the shape a `restrict` privacy policy produces. */
const WITHOUT_CONTENT: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  canSeeCosts: true,
};

const PERMITTED_SQL =
  "SELECT count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)";

/** Reads a column gated on captured input. */
const CONTENT_SQL =
  "SELECT CapturedInput AS value FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)";

const VALID_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "query_result" },
  mark: "bar",
  encoding: { y: { field: "value", type: "quantitative" } },
};

/** Reads a dataset the workbench does not register. */
const UNREGISTERED_DATASET_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "somebody_elses_data" },
  mark: "bar",
};

/** Loads its data over the network — refused before it can reach Vega. */
const NETWORK_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { url: "https://example.invalid/rows.json" },
  mark: "bar",
};

function definition(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: WORKBENCH_CHART_DEFINITION_VERSION,
    sql: PERMITTED_SQL,
    parameters: {},
    vegaLiteSpec: VALID_SPEC,
    ...overrides,
  };
}

/**
 * An in-memory store. Holds whatever it is given, exactly as given, so a test
 * can ask what reached storage rather than whether a method was called.
 */
class FakeStore implements SavedWorkbenchChartStore {
  readonly rows = new Map<string, CustomGraph>();

  private row(input: {
    id: string;
    projectId: string;
    name: string;
    graph: unknown;
  }): CustomGraph {
    return {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      graph: input.graph,
      filters: null,
      kind: WORKBENCH_SQL_CHART_KIND,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      dashboardId: null,
      gridColumn: 0,
      gridRow: 0,
      colSpan: 1,
      rowSpan: 1,
    } as CustomGraph;
  }

  async findAll({ projectId }: { projectId: string }): Promise<CustomGraph[]> {
    return [...this.rows.values()].filter((row) => row.projectId === projectId);
  }

  async findById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    const row = this.rows.get(id);
    return row && row.projectId === projectId ? row : null;
  }

  async create(input: CreateSavedWorkbenchChartInput): Promise<CustomGraph> {
    const row = this.row({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      graph: input.definition,
    });
    this.rows.set(row.id, row);
    return row;
  }

  async update(
    input: UpdateSavedWorkbenchChartInput,
  ): Promise<CustomGraph | null> {
    const existing = await this.findById({
      id: input.id,
      projectId: input.projectId,
    });
    if (!existing) return null;

    const row = this.row({
      id: existing.id,
      projectId: existing.projectId,
      name: input.name ?? existing.name,
      graph: input.definition ?? existing.graph,
    });
    this.rows.set(row.id, row);
    return row;
  }

  async delete({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<number> {
    const existing = await this.findById({ id, projectId });
    if (!existing) return 0;
    this.rows.delete(id);
    return 1;
  }
}

function build() {
  const store = new FakeStore();
  const service = new SavedWorkbenchChartService({
    repository: store,
    // No executor: the gate is a policy decision, not a database round trip.
    lwql: new LangWatchQLService({
      executor: null,
      database: "analytics",
    }),
  });
  return { store, service };
}

async function refusalOf(run: () => Promise<unknown>): Promise<{
  code: unknown;
  meta: unknown;
}> {
  try {
    await run();
  } catch (error) {
    return {
      code: (error as { code?: unknown }).code,
      meta: (error as { meta?: unknown }).meta,
    };
  }
  throw new Error("expected the save to be refused, but it succeeded");
}

describe("saving a workbench chart", () => {
  describe("given a specification the chart policy refuses", () => {
    describe("when the member saves a chart carrying it", () => {
      /** @scenario "A specification the chart policy refuses never reaches the database" */
      it("refuses it, names what was wrong, and writes nothing", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: {
              name: "Unknown dataset",
              definition: definition({
                vegaLiteSpec: UNREGISTERED_DATASET_SPEC,
              }),
            },
          }),
        );

        expect(refusal.code).toBe(
          "saved_workbench_chart_specification_refused",
        );
        // The editor needs to know *where*, not just that something was wrong.
        expect(
          (refusal.meta as { errors?: unknown[] }).errors?.length,
        ).toBeGreaterThan(0);
        expect(store.rows.size).toBe(0);
      });

      /** @scenario "A specification the chart policy refuses never reaches the database" */
      it("refuses one that would load its data over the network", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: {
              name: "Network data",
              definition: definition({ vegaLiteSpec: NETWORK_SPEC }),
            },
          }),
        );

        expect(refusal.code).toBe(
          "saved_workbench_chart_specification_refused",
        );
        expect(store.rows.size).toBe(0);
      });
    });
  });

  describe("given SQL the LangWatchQL validator refuses", () => {
    describe("when the member saves a chart carrying it", () => {
      /** @scenario "SQL the LangWatchQL validator refuses never reaches the database" */
      it("refuses it with the validator's own code and writes nothing", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: {
              name: "A write dressed as a chart",
              definition: definition({
                sql: "DROP TABLE analytics.traces",
              }),
            },
          }),
        );

        expect(refusal.code).toBe("lwql_not_permitted");
        expect(store.rows.size).toBe(0);
      });
    });
  });

  describe("given SQL declaring a parameter the definition supplies no value for", () => {
    describe("when the member saves the chart", () => {
      /** @scenario "A query whose declared parameters have no saved values is refused at save" */
      it("refuses it and names the missing parameter", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: {
              name: "Unbound parameter",
              definition: definition({
                sql:
                  "SELECT count() AS value FROM analytics.traces " +
                  "WHERE OccurredAt >= {since:DateTime}",
                parameters: {},
              }),
            },
          }),
        );

        expect(refusal.code).toBe("lwql_parameter_missing");
        expect((refusal.meta as { parameters?: unknown }).parameters).toEqual([
          "since",
        ]);
        expect(store.rows.size).toBe(0);
      });

      it("admits it once the value is saved alongside the query", async () => {
        const { store, service } = build();

        await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: {
            name: "Bound parameter",
            definition: definition({
              sql:
                "SELECT count() AS value FROM analytics.traces " +
                "WHERE OccurredAt >= {since:DateTime}",
              parameters: { since: "2026-02-01 00:00:00" },
            }),
          },
        });

        expect(store.rows.size).toBe(1);
      });
    });
  });

  describe("given a member whose protections withhold a content-gated column", () => {
    describe("when they save a chart whose SQL names it", () => {
      /** @scenario "What the author may read decides what their saved SQL may name" */
      it("refuses the save with the same refusal the query endpoint gives them", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: WITHOUT_CONTENT,
            input: {
              name: "Captured input",
              definition: definition({ sql: CONTENT_SQL }),
            },
          }),
        );

        expect(refusal.code).toBe("lwql_not_permitted");
        expect(store.rows.size).toBe(0);

        // Falsifiable: the identical statement is admitted for an author whose
        // protections do not withhold the column, so the refusal is about the
        // permissions rather than about the SQL.
        await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: {
            name: "Captured input",
            definition: definition({ sql: CONTENT_SQL }),
          },
        });
        expect(store.rows.size).toBe(1);
      });
    });
  });

  describe("given a definition that is not the shape a saved chart has", () => {
    describe("when the member saves it", () => {
      it("refuses it as invalid input and writes nothing", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: { name: "Shapeless", definition: { sql: PERMITTED_SQL } },
          }),
        );

        expect(refusal.code).toBe("validation_error");
        expect(store.rows.size).toBe(0);
      });
    });
  });

  describe("given identity fields outside the stored bounds", () => {
    describe("when the member saves a chart with an over-long name", () => {
      it("refuses it as invalid input and writes nothing", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: { name: "x".repeat(256), definition: definition() },
          }),
        );

        expect(refusal.code).toBe("validation_error");
        expect(store.rows.size).toBe(0);
      });
    });

    describe("when the member saves a chart with an id no store should carry", () => {
      it("refuses it as invalid input and writes nothing", async () => {
        const { store, service } = build();

        const refusal = await refusalOf(() =>
          service.createChart({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: {
              id: "not/a/valid/id",
              name: "Traces per day",
              definition: definition(),
            },
          }),
        );

        expect(refusal.code).toBe("validation_error");
        expect(store.rows.size).toBe(0);
      });
    });
  });

  describe("given a definition both governors accept", () => {
    describe("when the member saves it", () => {
      it("stores the query, its parameters and its specification together", async () => {
        const { store, service } = build();

        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });

        expect(saved.name).toBe("Traces per day");
        expect(saved.definition.sql).toBe(PERMITTED_SQL);
        expect(saved.definition.vegaLiteSpec).toEqual(VALID_SPEC);
        // The stored `kind` is deliberately not asserted here: the fake writes
        // it, so the assertion would read back the fake's own constant. The
        // integration suite proves it against the real database.
        expect(store.rows.has(saved.id)).toBe(true);
      });

      it("saves a query with no specification as the same kind of record", async () => {
        const { service } = build();

        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: {
            name: "Just the query",
            definition: {
              version: WORKBENCH_CHART_DEFINITION_VERSION,
              sql: PERMITTED_SQL,
            },
          },
        });

        expect(saved.definition.vegaLiteSpec).toBeUndefined();
      });
    });
  });
});

describe("editing a saved workbench chart", () => {
  describe("given a chart that passed both governors", () => {
    describe("when the member updates it with something either governor refuses", () => {
      /** @scenario "Editing a saved chart runs exactly the governors that creating it ran" */
      it("refuses for the same reason and leaves the saved definition as it was", async () => {
        const { store, service } = build();
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });

        const refusedSpec = await refusalOf(() =>
          service.updateChart({
            id: saved.id,
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: {
              definition: definition({
                vegaLiteSpec: UNREGISTERED_DATASET_SPEC,
              }),
            },
          }),
        );
        const refusedSql = await refusalOf(() =>
          service.updateChart({
            id: saved.id,
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            input: {
              definition: definition({ sql: "DROP TABLE analytics.traces" }),
            },
          }),
        );

        expect(refusedSpec.code).toBe(
          "saved_workbench_chart_specification_refused",
        );
        expect(refusedSql.code).toBe("lwql_not_permitted");

        // The row is exactly what the accepted create wrote.
        expect(store.rows.get(saved.id)?.graph).toEqual(definition());
      });
    });

    describe("when the member renames it without touching the definition", () => {
      it("keeps the stored definition and changes only the name", async () => {
        const { service } = build();
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });

        const renamed = await service.updateChart({
          id: saved.id,
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per week" },
        });

        expect(renamed.name).toBe("Traces per week");
        expect(renamed.definition).toEqual(saved.definition);
      });
    });
  });
});
