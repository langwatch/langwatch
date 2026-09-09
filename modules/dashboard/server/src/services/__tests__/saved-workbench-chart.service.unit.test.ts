/**
 * The saved-workbench-chart orchestration around the Analytics validator:
 * what gets parsed, what the validator is asked, what a missing row does and
 * what a placement defaults to. Governance itself is the policy service's.
 */

import type {
  AnalyticsApi,
  LangWatchQLProtections,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { VEGA_LITE_SCHEMA_URL } from "@langwatch/analytics-contract/visualization/validation";
import {
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartValidationError,
  WORKBENCH_CHART_DEFINITION_VERSION,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type {
  DashboardRecord,
  GraphRecord,
  SavedWorkbenchChartRecord,
} from "../../repositories/dashboard.repository.ts";
import { SavedWorkbenchChartPolicyService } from "../saved-workbench-chart-policy.service.ts";
import {
  SavedWorkbenchChartService,
  type SavedWorkbenchChartRepository,
} from "../saved-workbench-chart.service.ts";

const PROTECTIONS = { canSeePII: false } as unknown as LangWatchQLProtections;

function definition(overrides: Partial<SavedWorkbenchChartDefinition> = {}) {
  return {
    version: WORKBENCH_CHART_DEFINITION_VERSION,
    sql: "SELECT 1",
    parameters: {},
    ...overrides,
  } as SavedWorkbenchChartDefinition;
}

function record(overrides: Partial<SavedWorkbenchChartRecord> = {}): SavedWorkbenchChartRecord {
  return {
    id: "chart-1",
    projectId: "project-1",
    name: "Spend by model",
    definition: definition(),
    dashboardId: null,
    gridColumn: 0,
    gridRow: 0,
    colSpan: 1,
    rowSpan: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** A dashboard as the placement read finds it. */
function dashboardRecord(): DashboardRecord & { graphs: GraphRecord[] } {
  return {
    id: "dashboard-1",
    projectId: "project-1",
    name: "Reports",
    order: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    graphs: [],
  };
}

/**
 * Records what it was asked for; every method answers from what it was given.
 * It implements exactly the slice of the repository this service names.
 */
class FakeRepository implements SavedWorkbenchChartRepository {
  readonly calls: Array<{ method: string; input: unknown }> = [];

  constructor(
    private readonly answers: {
      charts?: SavedWorkbenchChartRecord[];
      chart?: SavedWorkbenchChartRecord | undefined;
      created?: SavedWorkbenchChartRecord;
      updated?: SavedWorkbenchChartRecord | undefined;
      placed?: SavedWorkbenchChartRecord | undefined;
      unplaced?: SavedWorkbenchChartRecord | undefined;
      deleted?: number;
      dashboard?: (DashboardRecord & { graphs: GraphRecord[] }) | undefined;
      lastGridRow?: number | undefined;
    } = {},
  ) {}

  private note(method: string, input: unknown) {
    this.calls.push({ method, input });
  }

  async findAllSavedWorkbenchCharts(input: unknown) {
    this.note("findAllSavedWorkbenchCharts", input);
    return this.answers.charts ?? [];
  }
  async findSavedWorkbenchChart(input: unknown) {
    this.note("findSavedWorkbenchChart", input);
    return this.answers.chart;
  }
  async createSavedWorkbenchChart(input: unknown) {
    this.note("createSavedWorkbenchChart", input);
    return this.answers.created ?? record();
  }
  async updateSavedWorkbenchChart(input: unknown) {
    this.note("updateSavedWorkbenchChart", input);
    if (!this.answers.updated) throw new SavedWorkbenchChartNotFoundError();
    return this.answers.updated;
  }
  async deleteSavedWorkbenchChart(input: unknown) {
    this.note("deleteSavedWorkbenchChart", input);
    if ((this.answers.deleted ?? 1) === 0) throw new SavedWorkbenchChartNotFoundError();
  }
  async placeSavedWorkbenchChart(input: unknown) {
    this.note("placeSavedWorkbenchChart", input);
    if (!this.answers.placed) throw new SavedWorkbenchChartNotFoundError();
    return this.answers.placed;
  }
  async unplaceSavedWorkbenchChart(input: unknown) {
    this.note("unplaceSavedWorkbenchChart", input);
    if (!this.answers.unplaced) throw new SavedWorkbenchChartNotFoundError();
    return this.answers.unplaced;
  }
  async findDashboard(input: unknown) {
    this.note("findDashboard", input);
    return this.answers.dashboard;
  }
  async findLastGraphGridRow(input: unknown) {
    this.note("findLastGraphGridRow", input);
    return this.answers.lastGridRow;
  }
}

/** The Analytics half of the gate: what it was asked, and whether it refuses. */
function recordingAnalytics(refusal?: Error) {
  const validated: LangWatchQLValidationInput[] = [];
  const executed: unknown[] = [];
  const analytics = createApiFixture<AnalyticsApi>({
    validateLangWatchQL: (input: LangWatchQLValidationInput) => {
      validated.push(input);
      if (refusal) throw refusal;
      return undefined;
    },
    executeLangWatchQL: async (input: unknown) => {
      executed.push(input);
      return { rows: [] } as never;
    },
  });

  return { analytics, validated, executed };
}

function build(options: { repository?: FakeRepository; refusal?: Error } = {}) {
  const repository = options.repository ?? new FakeRepository();
  const { analytics, validated, executed } = recordingAnalytics(options.refusal);

  return {
    repository,
    validated,
    executed,
    service: SavedWorkbenchChartService.create({
      repository,
      policy: SavedWorkbenchChartPolicyService.create({ analytics }),
      analytics,
    }),
  };
}

describe("SavedWorkbenchChartService", () => {
  describe("given a chart being created", () => {
    describe("when the caller supplies no id", () => {
      it("mints one rather than letting the store choose", async () => {
        const { service, repository } = build();

        await service.create({
          projectId: "project-1",
          protections: PROTECTIONS,
          name: "Spend",
          definition: definition(),
        });

        const call = repository.calls.find((c) => c.method === "createSavedWorkbenchChart");
        expect((call?.input as { id: string }).id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      });
    });

    describe("when the caller supplies an id no store should carry", () => {
      it("refuses it instead of writing the row", async () => {
        const { service, repository } = build();

        await expect(
          service.create({
            projectId: "project-1",
            protections: PROTECTIONS,
            name: "Spend",
            definition: definition(),
            id: "not a valid id!",
          }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
        expect(repository.calls.some((c) => c.method === "createSavedWorkbenchChart")).toBe(false);
      });
    });

    describe("when the name is longer than the column holds", () => {
      it("refuses it", async () => {
        const { service } = build();

        await expect(
          service.create({
            projectId: "project-1",
            protections: PROTECTIONS,
            name: "x".repeat(256),
            definition: definition(),
          }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
      });
    });

    describe("when the definition carries a query, parameters and a specification", () => {
      /**
       * @scenario "A saved definition carries the query, its parameter values and its specification"
       */
      it("stores them together rather than only the query", async () => {
        const { service, repository } = build();
        const spec = {
          $schema: VEGA_LITE_SCHEMA_URL,
          data: { name: "query_result" },
          mark: "bar",
          encoding: { y: { field: "value", type: "quantitative" } },
        };

        await service.create({
          projectId: "project-1",
          protections: PROTECTIONS,
          name: "Traces per day",
          definition: definition({
            sql: "SELECT count() FROM traces",
            parameters: { since: "2026-02-01" },
            vegaLiteSpec: spec,
          }),
        });

        const call = repository.calls.find((c) => c.method === "createSavedWorkbenchChart");
        expect((call?.input as { definition: SavedWorkbenchChartDefinition }).definition).toEqual({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: "SELECT count() FROM traces",
          parameters: { since: "2026-02-01" },
          vegaLiteSpec: spec,
        });
      });
    });

    describe("when the name is blank", () => {
      it("refuses it", async () => {
        const { service } = build();

        await expect(
          service.create({
            projectId: "project-1",
            protections: PROTECTIONS,
            name: "   ",
            definition: definition(),
          }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
      });
    });

    describe("when the definition is not the shape a saved chart has", () => {
      it("refuses it before the policy is troubled", async () => {
        const { service, validated } = build();

        await expect(
          service.create({
            projectId: "project-1",
            protections: PROTECTIONS,
            name: "Spend",
            definition: { version: 99, sql: "SELECT 1", parameters: {} },
          }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
        expect(validated).toHaveLength(0);
      });
    });

    describe("when the definition parses", () => {
      /** @scenario "Saved chart governance is called before persistence" */
      it("asks the policy about it with the caller's own protections", async () => {
        const { service, validated } = build();

        await service.create({
          projectId: "project-1",
          protections: PROTECTIONS,
          name: "Spend",
          definition: definition({ sql: "SELECT model FROM traces" }),
        });

        expect(validated).toHaveLength(1);
        expect(validated[0]?.protections).toBe(PROTECTIONS);
        expect(validated[0]?.sql).toBe("SELECT model FROM traces");
      });
    });

    describe("when the policy refuses the definition", () => {
      /** @scenario "A specification the chart policy refuses never reaches the database" */
      /** @scenario "SQL the LangWatchQL validator refuses never reaches the database" */
      it("does not write the row", async () => {
        const refusal = new Error("column is content-gated");
        const { service, repository } = build({ refusal });

        await expect(
          service.create({
            projectId: "project-1",
            protections: PROTECTIONS,
            name: "Spend",
            definition: definition(),
          }),
        ).rejects.toBe(refusal);
        expect(repository.calls.some((c) => c.method === "createSavedWorkbenchChart")).toBe(false);
      });
    });
  });

  describe("given a chart being updated", () => {
    describe("when the definition changes and the caller's protections come with it", () => {
      /** @scenario "Editing a saved chart runs exactly the governors that creating it ran" */
      it("asks the policy about the new definition, exactly as a create does", async () => {
        const repository = new FakeRepository({ chart: record(), updated: record() });
        const { service, validated } = build({ repository });
        const edited = definition({ sql: "SELECT cost FROM traces" });

        await service.update({
          projectId: "project-1",
          chartId: "chart-1",
          definitionUpdate: { protections: PROTECTIONS, definition: edited },
        });

        expect(validated).toEqual([
          {
            projectId: "project-1",
            protections: PROTECTIONS,
            sql: edited.sql,
            parameters: edited.parameters,
          },
        ]);
      });

      /** @scenario "Editing a saved chart runs exactly the governors that creating it ran" */
      it("does not write the row when the policy refuses the edit", async () => {
        const repository = new FakeRepository({ chart: record(), updated: record() });
        const { service } = build({
          repository,
          refusal: new Error("refused by the chart policy"),
        });

        await expect(
          service.update({
            projectId: "project-1",
            chartId: "chart-1",
            definitionUpdate: {
              protections: PROTECTIONS,
              definition: definition({ sql: "SELECT CapturedInput FROM traces" }),
            },
          }),
        ).rejects.toThrow("refused by the chart policy");

        expect(repository.calls.some((c) => c.method === "updateSavedWorkbenchChart")).toBe(false);
      });
    });

    describe("when only the name changes", () => {
      it("leaves the policy alone, since no SQL was touched", async () => {
        const repository = new FakeRepository({ chart: record(), updated: record() });
        const { service, validated } = build({ repository });

        await service.update({ projectId: "project-1", chartId: "chart-1", name: "Renamed" });

        expect(validated).toHaveLength(0);
      });
    });

    describe("when the row has gone between the read and the write", () => {
      it("reports it as not found", async () => {
        const repository = new FakeRepository({ chart: record(), updated: undefined });
        const { service } = build({ repository });

        await expect(
          service.update({ projectId: "project-1", chartId: "chart-1", name: "Renamed" }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      });
    });
  });

  describe("given a chart being read back", () => {
    describe("when the stored definition no longer parses", () => {
      /**
       * @scenario "A stored definition that no longer matches the schema is named, not returned as data"
       */
      it("says the definition is invalid, naming the chart", async () => {
        const repository = new FakeRepository({
          chart: record({ definition: { version: 99 } }),
        });
        const { service } = build({ repository });

        await expect(
          service.getById({ projectId: "project-1", chartId: "chart-1" }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartDefinitionInvalidError);
      });
    });

    describe("when the chart is not there", () => {
      it("reports it as not found", async () => {
        const { service } = build({ repository: new FakeRepository({ chart: undefined }) });

        await expect(
          service.getById({ projectId: "project-1", chartId: "chart-1" }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      });
    });
  });

  describe("given a chart being placed on a dashboard", () => {
    describe("when the dashboard does not exist", () => {
      it("says so rather than reporting the chart missing", async () => {
        const { service } = build({ repository: new FakeRepository({ dashboard: undefined }) });

        await expect(
          service.place({
            projectId: "project-1",
            chartId: "chart-1",
            dashboardId: "dashboard-1",
          }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartDashboardNotFoundError);
      });
    });

    describe("when no row is given and the dashboard already has graphs", () => {
      /**
       * @scenario "Placing a chart requires a dashboard id and accepts an optional grid position"
       */
      it("places it on the row after the last one", async () => {
        const repository = new FakeRepository({
          dashboard: dashboardRecord(),
          lastGridRow: 4,
          placed: record(),
        });
        const { service } = build({ repository });

        await service.place({
          projectId: "project-1",
          chartId: "chart-1",
          dashboardId: "dashboard-1",
        });

        const call = repository.calls.find((c) => c.method === "placeSavedWorkbenchChart");
        expect((call?.input as { gridRow: number }).gridRow).toBe(5);
      });
    });

    describe("when no row is given and the dashboard is empty", () => {
      it("places it on the first row", async () => {
        const repository = new FakeRepository({
          dashboard: dashboardRecord(),
          lastGridRow: undefined,
          placed: record(),
        });
        const { service } = build({ repository });

        await service.place({
          projectId: "project-1",
          chartId: "chart-1",
          dashboardId: "dashboard-1",
        });

        const call = repository.calls.find((c) => c.method === "placeSavedWorkbenchChart");
        expect((call?.input as { gridRow: number }).gridRow).toBe(0);
      });
    });

    describe("when a row is given", () => {
      /**
       * @scenario "Placing a chart requires a dashboard id and accepts an optional grid position"
       */
      it("uses it and does not ask where the last graph sits", async () => {
        const repository = new FakeRepository({
          dashboard: dashboardRecord(),
          placed: record(),
        });
        const { service } = build({ repository });

        await service.place({
          projectId: "project-1",
          chartId: "chart-1",
          dashboardId: "dashboard-1",
          gridRow: 2,
        });

        expect(repository.calls.some((c) => c.method === "findLastGraphGridRow")).toBe(false);
        const call = repository.calls.find((c) => c.method === "placeSavedWorkbenchChart");
        expect((call?.input as { gridRow: number }).gridRow).toBe(2);
      });
    });
  });

  describe("given a placement with no dashboard on it", () => {
    /** @scenario "Placing a chart requires a dashboard id and accepts an optional grid position" */
    it("refuses before anything is looked up", async () => {
      const repository = new FakeRepository({ dashboard: dashboardRecord() });
      const { service } = build({ repository });

      await expect(
        service.place({
          projectId: "project-1",
          chartId: "chart-1",
          dashboardId: "",
        }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);

      expect(repository.calls).toEqual([]);
    });
  });

  describe("given a chart id this project does not hold", () => {
    /** @scenario "Placing a chart that does not exist in this project is refused" */
    it("refuses the placement as not found, even onto a dashboard that is the project's", async () => {
      const repository = new FakeRepository({
        dashboard: dashboardRecord(),
        placed: undefined,
      });
      const { service } = build({ repository });

      await expect(
        service.place({
          projectId: "project-1",
          chartId: "another-projects-chart",
          dashboardId: "dashboard-1",
        }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
    });

    /** @scenario "Another project's saved chart is not runnable" */
    it("refuses to run it, and executes nothing", async () => {
      const repository = new FakeRepository({ chart: undefined });
      const { service, executed } = build({ repository });

      await expect(
        service.run({
          projectId: "project-1",
          chartId: "another-projects-chart",
          execution: { projectId: "project-1" } as never,
        }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);

      expect(executed).toEqual([]);
    });
  });

  describe("given a chart being deleted", () => {
    describe("when no row was removed", () => {
      it("reports it as not found rather than succeeding quietly", async () => {
        const { service } = build({ repository: new FakeRepository({ deleted: 0 }) });

        await expect(
          service.delete({ projectId: "project-1", chartId: "chart-1" }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      });
    });
  });

  describe("given a chart being run", () => {
    describe("when it is executed", () => {
      it("runs the stored SQL and parameters, not anything the caller passed", async () => {
        const stored = definition({ sql: "SELECT cost FROM traces", parameters: { days: 7 } });
        const repository = new FakeRepository({ chart: record({ definition: stored }) });
        const { service, executed } = build({ repository });

        await service.run({
          projectId: "project-1",
          chartId: "chart-1",
          execution: { projectId: "project-1" } as never,
        });

        expect(executed).toHaveLength(1);
        expect(executed[0]).toMatchObject({
          sql: "SELECT cost FROM traces",
          parameters: { days: 7 },
        });
      });
    });

    describe("when the surface asks for a window, a step, and what to do if it overflows", () => {
      it("forwards all three, so a period wider than the saved step can coarsen", async () => {
        const repository = new FakeRepository({ chart: record() });
        const { service, executed } = build({ repository });

        await service.run({
          projectId: "project-1",
          chartId: "chart-1",
          execution: {
            project: { projectId: "project-1" },
            protections: PROTECTIONS,
            timeWindow: { from: 0, to: 1 },
            granularitySeconds: 3600,
            onBudgetOverflow: "coarsen",
          } as never,
        });

        expect(executed[0]).toMatchObject({
          timeWindow: { from: 0, to: 1 },
          granularitySeconds: 3600,
          onBudgetOverflow: "coarsen",
        });
      });
    });
  });
});
