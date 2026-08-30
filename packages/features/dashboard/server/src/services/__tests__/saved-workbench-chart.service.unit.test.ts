/**
 * The saved-workbench-chart orchestration that actually runs.
 *
 * Reached from tRPC through `apps/api`'s mount, the package's own transport,
 * `DashboardApp` and `DashboardService`. Governance — LWQL validation,
 * protections, declared parameters — is not here: the service hands a
 * definition to the `SavedWorkbenchChartPolicy` port and the application wires
 * that to the Analytics validator. What is here is everything around it, which
 * had no test of its own: what gets parsed, what the policy is asked, what a
 * missing row does, and what a placement defaults to.
 */

import { describe, expect, it } from "vitest";
import {
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartDefinitionUpdateProtectionsRequiredError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartValidationError,
  WORKBENCH_CHART_DEFINITION_VERSION,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import type { LangWatchQLProtections, LangWatchQLService } from "@langwatch/analytics-contract";
import {
  DashboardIdGenerator,
  type DashboardRepository,
  SavedWorkbenchChartPolicy,
  type SavedWorkbenchChartRecord,
} from "../../ports/dashboard.port";
import { SavedWorkbenchChartService } from "../saved-workbench-chart.service";

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

/**
 * Records what it was asked for; every method answers from what it was given.
 *
 * Deliberately not `extends DashboardRepository`: that port carries fifteen
 * methods and this service touches nine, so implementing the rest as throwing
 * stubs would be noise. It is cast at the seam instead.
 */
class FakeRepository {
  readonly calls: Array<{ method: string; input: unknown }> = [];

  constructor(
    private readonly answers: {
      charts?: SavedWorkbenchChartRecord[];
      chart?: SavedWorkbenchChartRecord | null;
      created?: SavedWorkbenchChartRecord;
      updated?: SavedWorkbenchChartRecord | null;
      placed?: SavedWorkbenchChartRecord | null;
      unplaced?: SavedWorkbenchChartRecord | null;
      deleted?: number;
      dashboard?: object | null;
      lastGridRow?: number | null;
    } = {},
  ) {}

  private note(method: string, input: unknown) {
    this.calls.push({ method, input });
  }

  async findAllSavedWorkbenchCharts(input: unknown) {
    this.note("findAllSavedWorkbenchCharts", input);
    return this.answers.charts ?? [];
  }
  async tryFindSavedWorkbenchChart(input: unknown) {
    this.note("tryFindSavedWorkbenchChart", input);
    return this.answers.chart ?? null;
  }
  async createSavedWorkbenchChart(input: unknown) {
    this.note("createSavedWorkbenchChart", input);
    return this.answers.created ?? record();
  }
  async tryUpdateSavedWorkbenchChart(input: unknown) {
    this.note("tryUpdateSavedWorkbenchChart", input);
    return this.answers.updated ?? null;
  }
  async deleteSavedWorkbenchChart(input: unknown) {
    this.note("deleteSavedWorkbenchChart", input);
    return this.answers.deleted ?? 1;
  }
  async tryPlaceSavedWorkbenchChart(input: unknown) {
    this.note("tryPlaceSavedWorkbenchChart", input);
    return this.answers.placed ?? null;
  }
  async tryUnplaceSavedWorkbenchChart(input: unknown) {
    this.note("tryUnplaceSavedWorkbenchChart", input);
    return this.answers.unplaced ?? null;
  }
  async tryFindDashboard(input: unknown) {
    this.note("tryFindDashboard", input);
    return this.answers.dashboard ?? null;
  }
  async tryFindLastGraphGridRow(input: unknown) {
    this.note("tryFindLastGraphGridRow", input);
    return this.answers.lastGridRow ?? null;
  }
}

class RecordingPolicy extends SavedWorkbenchChartPolicy {
  readonly seen: Array<{
    projectId: string;
    protections: LangWatchQLProtections;
    definition: SavedWorkbenchChartDefinition;
  }> = [];

  constructor(private readonly refusal?: Error) {
    super();
  }

  async validate(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    definition: SavedWorkbenchChartDefinition;
  }): Promise<void> {
    this.seen.push(input);
    if (this.refusal) throw this.refusal;
  }
}

class FixedIds extends DashboardIdGenerator {
  constructor(private readonly id = "generated-id") {
    super();
  }
  generate(): string {
    return this.id;
  }
}

function build(
  options: {
    repository?: FakeRepository;
    policy?: RecordingPolicy;
    ids?: FixedIds;
    langWatchQL?: Partial<LangWatchQLService>;
  } = {},
) {
  const repository = options.repository ?? new FakeRepository();
  const policy = options.policy ?? new RecordingPolicy();
  const langWatchQL = (options.langWatchQL ?? {
    execute: async () => ({ rows: [] }),
  }) as LangWatchQLService;

  return {
    repository,
    policy,
    langWatchQL,
    service: SavedWorkbenchChartService.create({
      repository: repository as unknown as DashboardRepository,
      ids: options.ids ?? new FixedIds(),
      savedWorkbenchChartPolicy: policy,
      langWatchQL,
    }),
  };
}

describe("SavedWorkbenchChartService", () => {
  describe("given a chart being created", () => {
    describe("when the caller supplies no id", () => {
      it("mints one rather than letting the store choose", async () => {
        const { service, repository } = build({ ids: new FixedIds("minted") });

        await service.create({
          projectId: "project-1",
          protections: PROTECTIONS,
          name: "Spend",
          definition: definition(),
        });

        const call = repository.calls.find((c) => c.method === "createSavedWorkbenchChart");
        expect((call?.input as { id: string }).id).toBe("minted");
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
        const { service, policy } = build();

        await expect(
          service.create({
            projectId: "project-1",
            protections: PROTECTIONS,
            name: "Spend",
            definition: { version: 99, sql: "SELECT 1", parameters: {} },
          }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartValidationError);
        expect(policy.seen).toHaveLength(0);
      });
    });

    describe("when the definition parses", () => {
      it("asks the policy about it with the caller's own protections", async () => {
        const { service, policy } = build();

        await service.create({
          projectId: "project-1",
          protections: PROTECTIONS,
          name: "Spend",
          definition: definition({ sql: "SELECT model FROM traces" }),
        });

        expect(policy.seen).toHaveLength(1);
        expect(policy.seen[0]?.protections).toBe(PROTECTIONS);
        expect(policy.seen[0]?.definition.sql).toBe("SELECT model FROM traces");
      });
    });

    describe("when the policy refuses the definition", () => {
      it("does not write the row", async () => {
        const refusal = new Error("column is content-gated");
        const { service, repository } = build({ policy: new RecordingPolicy(refusal) });

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
    describe("when the definition changes but no protections come with it", () => {
      it("refuses, because nothing could judge the new SQL", async () => {
        const { service } = build({ repository: new FakeRepository({ chart: record() }) });

        await expect(
          service.update({
            projectId: "project-1",
            chartId: "chart-1",
            definitionUpdate: { definition: definition() } as never,
          }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartDefinitionUpdateProtectionsRequiredError);
      });
    });

    describe("when only the name changes", () => {
      it("leaves the policy alone, since no SQL was touched", async () => {
        const repository = new FakeRepository({ chart: record(), updated: record() });
        const { service, policy } = build({ repository });

        await service.update({ projectId: "project-1", chartId: "chart-1", name: "Renamed" });

        expect(policy.seen).toHaveLength(0);
      });
    });

    describe("when the row has gone between the read and the write", () => {
      it("reports it as not found", async () => {
        const repository = new FakeRepository({ chart: record(), updated: null });
        const { service } = build({ repository });

        await expect(
          service.update({ projectId: "project-1", chartId: "chart-1", name: "Renamed" }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      });
    });
  });

  describe("given a chart being read back", () => {
    describe("when the stored definition no longer parses", () => {
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
        const { service } = build({ repository: new FakeRepository({ chart: null }) });

        await expect(
          service.getById({ projectId: "project-1", chartId: "chart-1" }),
        ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      });
    });
  });

  describe("given a chart being placed on a dashboard", () => {
    describe("when the dashboard does not exist", () => {
      it("says so rather than reporting the chart missing", async () => {
        const { service } = build({ repository: new FakeRepository({ dashboard: null }) });

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
      it("places it on the row after the last one", async () => {
        const repository = new FakeRepository({
          dashboard: { id: "dashboard-1" },
          lastGridRow: 4,
          placed: record(),
        });
        const { service } = build({ repository });

        await service.place({
          projectId: "project-1",
          chartId: "chart-1",
          dashboardId: "dashboard-1",
        });

        const call = repository.calls.find((c) => c.method === "tryPlaceSavedWorkbenchChart");
        expect((call?.input as { gridRow: number }).gridRow).toBe(5);
      });
    });

    describe("when no row is given and the dashboard is empty", () => {
      it("places it on the first row", async () => {
        const repository = new FakeRepository({
          dashboard: { id: "dashboard-1" },
          lastGridRow: null,
          placed: record(),
        });
        const { service } = build({ repository });

        await service.place({
          projectId: "project-1",
          chartId: "chart-1",
          dashboardId: "dashboard-1",
        });

        const call = repository.calls.find((c) => c.method === "tryPlaceSavedWorkbenchChart");
        expect((call?.input as { gridRow: number }).gridRow).toBe(0);
      });
    });

    describe("when a row is given", () => {
      it("uses it and does not ask where the last graph sits", async () => {
        const repository = new FakeRepository({
          dashboard: { id: "dashboard-1" },
          placed: record(),
        });
        const { service } = build({ repository });

        await service.place({
          projectId: "project-1",
          chartId: "chart-1",
          dashboardId: "dashboard-1",
          gridRow: 2,
        });

        expect(repository.calls.some((c) => c.method === "tryFindLastGraphGridRow")).toBe(false);
        const call = repository.calls.find((c) => c.method === "tryPlaceSavedWorkbenchChart");
        expect((call?.input as { gridRow: number }).gridRow).toBe(2);
      });
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
        const executed: unknown[] = [];
        const { service } = build({
          repository,
          langWatchQL: {
            execute: async (input: unknown) => {
              executed.push(input);
              return { rows: [] } as never;
            },
          } as Partial<LangWatchQLService>,
        });

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
        const executed: unknown[] = [];
        const { service } = build({
          repository,
          langWatchQL: {
            execute: async (input: unknown) => {
              executed.push(input);
              return { rows: [] } as never;
            },
          } as Partial<LangWatchQLService>,
        });

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
