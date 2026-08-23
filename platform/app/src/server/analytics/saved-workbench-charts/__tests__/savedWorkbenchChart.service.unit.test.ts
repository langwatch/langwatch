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
import type {
  LangWatchQLExecutionRequest,
  LangWatchQLExecutor,
} from "../../lwql/executor";
import { LangWatchQLService } from "../../lwql/lwql.service";
import type {
  CreateSavedWorkbenchChartInput,
  PlaceSavedWorkbenchChartInput,
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
    /** Carried across an update/place/unplace so an untouched field survives. */
    placement?: {
      dashboardId: string | null;
      gridColumn: number;
      gridRow: number;
      colSpan: number;
      rowSpan: number;
    };
  }): CustomGraph {
    const placement = input.placement ?? {
      dashboardId: null,
      gridColumn: 0,
      gridRow: 0,
      colSpan: 1,
      rowSpan: 1,
    };
    return {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      graph: input.graph,
      filters: null,
      kind: WORKBENCH_SQL_CHART_KIND,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      ...placement,
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
      placement: {
        dashboardId: existing.dashboardId,
        gridColumn: existing.gridColumn,
        gridRow: existing.gridRow,
        colSpan: existing.colSpan,
        rowSpan: existing.rowSpan,
      },
    });
    this.rows.set(row.id, row);
    return row;
  }

  async place(
    input: PlaceSavedWorkbenchChartInput,
  ): Promise<CustomGraph | null> {
    const existing = await this.findById({
      id: input.id,
      projectId: input.projectId,
    });
    if (!existing) return null;

    const row = this.row({
      id: existing.id,
      projectId: existing.projectId,
      name: existing.name,
      graph: existing.graph,
      placement: {
        dashboardId: input.dashboardId,
        gridColumn: input.gridColumn,
        gridRow: input.gridRow,
        colSpan: input.colSpan,
        rowSpan: input.rowSpan,
      },
    });
    this.rows.set(row.id, row);
    return row;
  }

  async unplace({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    const existing = await this.findById({ id, projectId });
    if (!existing) return null;

    const row = this.row({
      id: existing.id,
      projectId: existing.projectId,
      name: existing.name,
      graph: existing.graph,
      // Defaults — the same shape `row()` already falls back to when no
      // placement is given, which is exactly "unplaced".
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

/**
 * An executor that records what it was asked to run and answers a fixed small
 * result — the same fake the LangWatchQL service suite drives, because the
 * claims worth making about a run are "what reached the database", which is an
 * artifact to inspect rather than a call sequence to verify.
 */
function recordingExecutor(): LangWatchQLExecutor & {
  readonly calls: LangWatchQLExecutionRequest[];
} {
  const calls: LangWatchQLExecutionRequest[] = [];
  return {
    calls,
    async execute(request) {
      calls.push(request);
      return {
        columns: [{ name: "value", type: "UInt64" }],
        rows: [{ value: 7 }],
        truncated: false,
        statistics: {
          elapsedMs: 2,
          rowsRead: 4,
          bytesRead: 40,
          rowsReturned: 1,
        },
      };
    },
  };
}

function build(
  executor: LangWatchQLExecutor | null = null,
  overrides: {
    /** Every dashboard belongs, by default: most suites are not testing tenancy. */
    dashboardBelongsToProject?: (
      dashboardId: string,
      projectId: string,
    ) => Promise<boolean>;
    /**
     * Row 0, by default: most suites place a single chart and never look at
     * the row it landed on.
     */
    allocateNextGridRow?: (input: {
      dashboardId: string;
      projectId: string;
    }) => Promise<number>;
  } = {},
) {
  const store = new FakeStore();
  const service = new SavedWorkbenchChartService({
    repository: store,
    // No executor by default: the save gate is a policy decision, not a
    // database round trip. The run suites pass a recording one.
    lwql: new LangWatchQLService({
      executor,
      database: "analytics",
    }),
    dashboardBelongsToProject:
      overrides.dashboardBelongsToProject ?? (async () => true),
    allocateNextGridRow: overrides.allocateNextGridRow ?? (async () => 0),
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

/**
 * The placement path: what makes an already-saved chart show up on a
 * dashboard. `dashboardBelongsToProject` and `allocateNextGridRow` are the
 * only two collaborators `placeChart` reaches for beyond the store, so this
 * suite drives them as plain fakes rather than a real Prisma client — the
 * same reason the store itself is a fake.
 */
describe("placing a saved workbench chart on a dashboard", () => {
  describe("given a saved chart and the id of a dashboard in the same project", () => {
    describe("when the chart is placed with no grid position supplied", () => {
      /** @scenario "Placing a chart requires a dashboard id and accepts an optional grid position" */
      it("accepts the placement and allocates a grid position for it", async () => {
        const { service } = build(null, {
          allocateNextGridRow: async () => 2,
        });
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });

        const placed = await service.placeChart({
          id: saved.id,
          projectId: PROJECT_ID,
          input: { dashboardId: "dashboard-1" },
        });

        expect(placed.dashboardId).toBe("dashboard-1");
        // Allocated, not defaulted to 0: the fake above stands in for "row 0
        // and row 1 are already taken".
        expect(placed.gridRow).toBe(2);
        expect(placed.gridColumn).toBe(0);
        expect(placed.colSpan).toBe(1);
        expect(placed.rowSpan).toBe(1);
      });
    });
  });

  describe("given a saved chart already placed on a dashboard with a grid position", () => {
    describe("when the chart is unplaced", () => {
      /** @scenario "Unplacing a chart clears every placement field, not just the dashboard id" */
      it("clears the dashboard id, grid column, grid row, column span and row span, and leaves the definition untouched", async () => {
        const { service } = build();
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });
        await service.placeChart({
          id: saved.id,
          projectId: PROJECT_ID,
          input: {
            dashboardId: "dashboard-1",
            gridColumn: 1,
            gridRow: 3,
            colSpan: 2,
            rowSpan: 2,
          },
        });

        const unplaced = await service.unplaceChart({
          id: saved.id,
          projectId: PROJECT_ID,
        });

        expect(unplaced.dashboardId).toBeNull();
        expect(unplaced.gridColumn).toBe(0);
        expect(unplaced.gridRow).toBe(0);
        expect(unplaced.colSpan).toBe(1);
        expect(unplaced.rowSpan).toBe(1);
        expect(unplaced.definition).toEqual(saved.definition);
      });
    });
  });

  describe("given a chart id that does not name a saved chart in this project", () => {
    describe("when the member tries to place it on a dashboard", () => {
      /** @scenario "Placing a chart that does not exist in this project is refused" */
      it("refuses the placement as not found", async () => {
        const { service } = build();

        const refusal = await refusalOf(() =>
          service.placeChart({
            id: "never-saved",
            projectId: PROJECT_ID,
            input: { dashboardId: "dashboard-1" },
          }),
        );

        expect(refusal.code).toBe("saved_workbench_chart_not_found");
      });
    });
  });

  describe("given a dashboard id belonging to another project", () => {
    describe("when the member tries to place a chart on it", () => {
      it("refuses the placement and writes nothing", async () => {
        const { store, service } = build(null, {
          dashboardBelongsToProject: async () => false,
        });
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });

        const refusal = await refusalOf(() =>
          service.placeChart({
            id: saved.id,
            projectId: PROJECT_ID,
            input: { dashboardId: "dashboard-elsewhere" },
          }),
        );

        expect(refusal.code).toBe("saved_workbench_chart_dashboard_not_found");
        expect(store.rows.get(saved.id)?.dashboardId).toBeNull();
      });
    });
  });

  describe("given a grid position outside what the store can hold", () => {
    // The REST envelope enforces integrality too, but the rule lives HERE:
    // the service is the single write path, and a future non-REST caller
    // must meet the same refusal, not the Int column's overflow error.
    describe("when the member places a chart with a fractional grid row", () => {
      it("refuses it as invalid input and writes nothing", async () => {
        const { store, service } = build();
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });

        const refusal = await refusalOf(() =>
          service.placeChart({
            id: saved.id,
            projectId: PROJECT_ID,
            input: { dashboardId: "dashboard-1", gridRow: 1.5 },
          }),
        );

        expect(refusal.code).toBe("validation_error");
        expect(store.rows.get(saved.id)?.dashboardId).toBeNull();
      });
    });

    describe("when the member places a chart with a grid row past the column's range", () => {
      it("refuses it as invalid input rather than overflowing the store", async () => {
        const { store, service } = build();
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: { name: "Traces per day", definition: definition() },
        });

        const refusal = await refusalOf(() =>
          service.placeChart({
            id: saved.id,
            projectId: PROJECT_ID,
            input: { dashboardId: "dashboard-1", gridRow: 9e15 },
          }),
        );

        expect(refusal.code).toBe("validation_error");
        expect(store.rows.get(saved.id)?.dashboardId).toBeNull();
      });
    });
  });
});

/**
 * The run path: what a saved chart becomes when someone opens it and presses
 * run. Same harness as saving — the real LangWatchQL gate over an in-memory
 * store — with a recording executor behind the gate, because the claims worth
 * making are about *what reached the database*: the stored statement, the
 * stored values, the surface's window and step, or nothing at all.
 */
describe("running a saved workbench chart", () => {
  /** The tenant the run executes for. Only these two fields are ever needed. */
  const RUNNER = { id: PROJECT_ID, lwqlKey: "sk-lw-run-chart-unit-test-key" };

  /** Seven days — wide enough that only the hour step fits the bucket ceiling. */
  const WEEK = {
    start: new Date("2026-02-20T00:00:00.000Z"),
    end: new Date("2026-02-27T00:00:00.000Z"),
  };

  /** Declares both reserved window bounds and the granularity parameter. */
  const BUCKETED_SQL =
    "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
    "count() AS value FROM analytics.traces " +
    "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
    "AND TraceName = {name:String} GROUP BY bucket ORDER BY bucket";

  async function saveBucketedChart(
    service: ReturnType<typeof build>["service"],
  ) {
    return await service.createChart({
      projectId: PROJECT_ID,
      protections: FULLY_PERMITTED,
      input: {
        name: "Traces per step",
        definition: definition({
          sql: BUCKETED_SQL,
          parameters: { name: "checkout" },
        }),
      },
    });
  }

  describe("given a chart saved with both reserved declarations and its own parameter values", () => {
    describe("when it is run with the surface's period and step", () => {
      /** @scenario "Running a saved chart executes its stored statement with its saved values and the surface's window and step" */
      it("executes the stored statement with all three bound, and reports the facts", async () => {
        const executor = recordingExecutor();
        const { service } = build(executor);
        const saved = await saveBucketedChart(service);

        const result = await service.runChart({
          id: saved.id,
          projectId: PROJECT_ID,
          project: RUNNER,
          protections: FULLY_PERMITTED,
          input: {
            timeWindow: WEEK,
            // An hour over a week: 168 buckets, inside the ceiling.
            granularitySeconds: 3600,
          },
        });

        expect(executor.calls).toHaveLength(1);
        expect(executor.calls[0]!.sql).toBe(BUCKETED_SQL);
        expect(executor.calls[0]!.parameters).toEqual({
          // Saved alongside the query at save time.
          name: "checkout",
          // Injected from the surface at run time.
          period_start: "2026-02-20 00:00:00",
          period_end: "2026-02-27 00:00:00",
          period_granularity_seconds: 3600,
        });
        expect(result.rows).toEqual([{ value: 7 }]);
        expect(result.followsTimeWindow).toBe(true);
        expect(result.followsGranularity).toBe(true);
        expect(result.granularitySeconds).toBe(3600);
      });
    });
  });

  describe("given a chart in another project, or an id nothing saved", () => {
    describe("when the runner names either on their own project", () => {
      /** @scenario "Another project's saved chart is not runnable" */
      it("answers not found, identically, and runs nothing", async () => {
        const executor = recordingExecutor();
        const { service } = build(executor);
        const saved = await saveBucketedChart(service);

        expect(
          (
            await refusalOf(() =>
              service.runChart({
                id: saved.id,
                projectId: "project-elsewhere",
                project: { ...RUNNER, id: "project-elsewhere" },
                protections: FULLY_PERMITTED,
                input: { timeWindow: WEEK },
              }),
            )
          ).code,
        ).toBe("saved_workbench_chart_not_found");
        expect(
          (
            await refusalOf(() =>
              service.runChart({
                id: "never-saved",
                projectId: PROJECT_ID,
                project: RUNNER,
                protections: FULLY_PERMITTED,
                input: {},
              }),
            )
          ).code,
        ).toBe("saved_workbench_chart_not_found");
        expect(executor.calls).toHaveLength(0);
      });
    });
  });

  describe("given a step finer than the period's bucket budget allows", () => {
    describe("when the chart declaring the granularity parameter is run with it", () => {
      /** @scenario "Running a saved chart refuses a step finer than the period's bucket budget" */
      it("refuses the run with the ceiling arithmetic and executes nothing", async () => {
        const executor = recordingExecutor();
        const { service } = build(executor);
        const saved = await saveBucketedChart(service);

        const refusal = await refusalOf(() =>
          service.runChart({
            id: saved.id,
            projectId: PROJECT_ID,
            project: RUNNER,
            protections: FULLY_PERMITTED,
            input: {
              timeWindow: WEEK,
              // A week of one-second buckets: 604,800, far past 10,000.
              granularitySeconds: 1,
            },
          }),
        );

        expect(refusal.code).toBe("lwql_granularity_too_fine");
        expect(refusal.meta).toMatchObject({
          requestedGranularitySeconds: 1,
          windowSeconds: 7 * 24 * 3600,
          maxBuckets: 10_000,
        });
        expect(executor.calls).toHaveLength(0);
      });
    });
  });

  describe("given a chart whose SQL reads a column the runner may no longer see", () => {
    describe("when someone with narrowed permissions runs it", () => {
      it("refuses the run on their own current protections, not the author's", async () => {
        const executor = recordingExecutor();
        const { service } = build(executor);
        const saved = await service.createChart({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          input: {
            name: "Captured input",
            definition: definition({ sql: CONTENT_SQL }),
          },
        });

        expect(
          (
            await refusalOf(() =>
              service.runChart({
                id: saved.id,
                projectId: PROJECT_ID,
                project: RUNNER,
                protections: WITHOUT_CONTENT,
                input: {},
              }),
            )
          ).code,
        ).toBe("lwql_not_permitted");
        expect(executor.calls).toHaveLength(0);

        // A caller who does hold the permission runs the very same chart.
        await service.runChart({
          id: saved.id,
          projectId: PROJECT_ID,
          project: RUNNER,
          protections: FULLY_PERMITTED,
          input: {},
        });
        expect(executor.calls).toHaveLength(1);
      });
    });
  });
});
