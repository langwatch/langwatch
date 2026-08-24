import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartsApiError } from "@/client-sdk/services/charts/charts-api.service";

vi.mock("@/client-sdk/services/charts/charts-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ChartsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
    projectId: "project-1",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { createChartCommand } from "../create";
import { deleteChartCommand } from "../delete";
import { getChartCommand } from "../get";
import { listChartsCommand } from "../list";
import { placeChartCommand } from "../place";
import { runChartCommand } from "../run";
import { unplaceChartCommand } from "../unplace";
import { updateChartCommand } from "../update";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const CHART = {
  id: "chart-1",
  name: "Traces per day",
  definition: {
    version: 1,
    sql: "SELECT count() AS value FROM analytics.traces WHERE OccurredAt >= {since:DateTime}",
    parameters: { since: "2026-02-01 00:00:00" },
    vegaLiteSpec: { mark: "bar" },
  },
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
  platformUrl: "https://app.langwatch.ai/project/analytics",
  dashboardId: null,
  gridColumn: 0,
  gridRow: 0,
  colSpan: 1,
  rowSpan: 1,
};

interface ServiceMocks {
  schema: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  place: ReturnType<typeof vi.fn>;
  unplace: ReturnType<typeof vi.fn>;
  runQuery: ReturnType<typeof vi.fn>;
}

const installServiceMocks = (): ServiceMocks => {
  const mocks: ServiceMocks = {
    schema: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    place: vi.fn(),
    unplace: vi.fn(),
    runQuery: vi.fn(),
  };
  vi.mocked(ChartsApiService).mockImplementation(function () {
    return mocks as unknown as ChartsApiService;
  });
  return mocks;
};

let mocks: ServiceMocks;

beforeEach(() => {
  vi.clearAllMocks();
  mocks = installServiceMocks();
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

describe("createChartCommand()", () => {
  describe("when given a statement, parameters and a specification file", () => {
    it("maps the flags into one create call with a v1 definition", async () => {
      mocks.create.mockResolvedValue(CHART);
      const dir = mkdtempSync(join(tmpdir(), "chart-cli-"));
      const specPath = join(dir, "spec.json");
      writeFileSync(specPath, JSON.stringify({ mark: "bar" }));

      await createChartCommand({
        name: "Traces per day",
        sql: CHART.definition.sql,
        param: ["since=2026-02-01 00:00:00", "limit=7", "active=true"],
        specFile: specPath,
      });

      expect(mocks.create).toHaveBeenCalledWith({
        name: "Traces per day",
        definition: {
          version: 1,
          sql: CHART.definition.sql,
          parameters: {
            since: "2026-02-01 00:00:00",
            limit: 7,
            active: true,
          },
          vegaLiteSpec: { mark: "bar" },
        },
      });
    });

    it("reads the statement from --sql-file when given one", async () => {
      mocks.create.mockResolvedValue(CHART);
      const dir = mkdtempSync(join(tmpdir(), "chart-cli-"));
      const sqlPath = join(dir, "query.sql");
      writeFileSync(sqlPath, "SELECT 1 AS value");

      await createChartCommand({ name: "From file", sqlFile: sqlPath });

      expect(mocks.create).toHaveBeenCalledWith({
        name: "From file",
        definition: { version: 1, sql: "SELECT 1 AS value", parameters: {} },
      });
    });
  });

  describe("when no statement is supplied", () => {
    it("refuses locally without calling the API", async () => {
      await expect(
        createChartCommand({ name: "No SQL" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });
});

describe("updateChartCommand()", () => {
  describe("when nothing is supplied to change", () => {
    it("refuses locally, matching the API's own refusal of an empty update", async () => {
      await expect(updateChartCommand("chart-1", {})).rejects.toThrow(
        ProcessExitError,
      );
      expect(mocks.update).not.toHaveBeenCalled();
    });
  });

  describe("when only a name is supplied", () => {
    it("sends the name and no definition", async () => {
      mocks.update.mockResolvedValue({ ...CHART, name: "Renamed" });

      await updateChartCommand("chart-1", { name: "Renamed" });

      expect(mocks.update).toHaveBeenCalledWith("chart-1", {
        name: "Renamed",
      });
    });
  });
});

describe("runChartCommand()", () => {
  describe("when run with a period and a granularity", () => {
    it("reads the chart, then executes its own SQL and stored parameters with the window", async () => {
      mocks.get.mockResolvedValue(CHART);
      mocks.runQuery.mockResolvedValue({
        columns: [{ name: "value", type: "UInt64" }],
        rows: [{ value: 42 }],
        statistics: { elapsedMs: 5, rowsRead: 1, bytesRead: 8, rowsReturned: 1 },
        truncated: false,
        followsTimeWindow: true,
        followsGranularity: true,
        diagnostics: [],
      });

      await runChartCommand("chart-1", {
        start: "2026-08-01T00:00:00Z",
        end: "2026-08-08T00:00:00Z",
        granularity: "3600",
      });

      expect(mocks.runQuery).toHaveBeenCalledWith({
        sql: CHART.definition.sql,
        parameters: CHART.definition.parameters,
        timeWindow: {
          start: "2026-08-01T00:00:00Z",
          end: "2026-08-08T00:00:00Z",
        },
        granularitySeconds: 3600,
      });
    });
  });

  describe("when only one of --start/--end is given", () => {
    it("refuses locally without calling the API", async () => {
      await expect(
        runChartCommand("chart-1", { start: "2026-08-01T00:00:00Z" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.runQuery).not.toHaveBeenCalled();
    });
  });

  describe("when --granularity is not one of the offered steps", () => {
    it("refuses locally, naming the offered steps, without calling the API", async () => {
      const errorSpy = vi.mocked(console.error);

      await expect(
        runChartCommand("chart-1", { granularity: "86400" }),
      ).rejects.toThrow(ProcessExitError);

      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.runQuery).not.toHaveBeenCalled();
      const message = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      // The refusal names every offered step, so the caller does not have to
      // guess which values the API accepts.
      expect(message).toContain("1 (1 second)");
      expect(message).toContain("60 (1 minute)");
      expect(message).toContain("3600 (1 hour)");
    });
  });

  describe("when --granularity is an offered step", () => {
    it("passes it through to the query", async () => {
      mocks.get.mockResolvedValue(CHART);
      mocks.runQuery.mockResolvedValue({
        columns: [],
        rows: [],
        statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
        truncated: false,
        followsTimeWindow: false,
        followsGranularity: true,
        diagnostics: [],
      });

      await runChartCommand("chart-1", { granularity: "60" });

      expect(mocks.runQuery).toHaveBeenCalledWith(
        expect.objectContaining({ granularitySeconds: 60 }),
      );
    });
  });
});

describe("deleteChartCommand()", () => {
  describe("when the platform answers 204 with no body", () => {
    it("confirms via the id the caller passed instead of reading a body", async () => {
      mocks.delete.mockResolvedValue(undefined);

      const result = await deleteChartCommand("chart-1");

      expect(mocks.delete).toHaveBeenCalledWith("chart-1");
      expect(result).toBeTruthy();
      expect(result!.data).toEqual({ id: "chart-1", deleted: true });
    });
  });
});

describe("placeChartCommand()", () => {
  describe("when given a dashboard and no grid position", () => {
    it("sends only the dashboard id, leaving allocation to the platform", async () => {
      mocks.place.mockResolvedValue({
        ...CHART,
        dashboardId: "dashboard-1",
        gridRow: 2,
      });

      await placeChartCommand("chart-1", { dashboardId: "dashboard-1" });

      expect(mocks.place).toHaveBeenCalledWith("chart-1", {
        dashboardId: "dashboard-1",
      });
    });
  });

  describe("when no dashboard id is given", () => {
    it("refuses locally without calling the API", async () => {
      await expect(placeChartCommand("chart-1", {})).rejects.toThrow(
        ProcessExitError,
      );
      expect(mocks.place).not.toHaveBeenCalled();
    });
  });
});

describe("the chart family's machine output", () => {
  describe("when each verb's result is requested as JSON", () => {
    /** @scenario "Every new CLI verb is machine-readable, not just human-formatted" */
    it("returns data that JSON round-trips with no human-only formatting in it", async () => {
      mocks.list.mockResolvedValue({ data: [CHART] });
      mocks.get.mockResolvedValue(CHART);
      mocks.create.mockResolvedValue(CHART);
      mocks.update.mockResolvedValue(CHART);
      mocks.delete.mockResolvedValue(undefined);
      mocks.place.mockResolvedValue({ ...CHART, dashboardId: "dashboard-1" });
      mocks.unplace.mockResolvedValue(undefined);
      mocks.runQuery.mockResolvedValue({
        columns: [],
        rows: [],
        statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
        truncated: false,
        followsTimeWindow: false,
        followsGranularity: false,
        diagnostics: [],
      });

      const results = [
        await listChartsCommand(),
        await getChartCommand(CHART.id),
        await createChartCommand({
          name: CHART.name,
          sql: CHART.definition.sql,
        }),
        await updateChartCommand(CHART.id, { name: "Renamed" }),
        await deleteChartCommand(CHART.id),
        await runChartCommand(CHART.id, {}),
        await placeChartCommand(CHART.id, { dashboardId: "dashboard-1" }),
        await unplaceChartCommand(CHART.id),
      ];

      for (const result of results) {
        expect(result, "every verb returns a CommandResult").toBeTruthy();
        const serialized = JSON.stringify(result!.data);
        // Parseable, lossless, and free of terminal escape codes: an agent
        // reads this without ever seeing the human table.
        expect(JSON.parse(serialized)).toEqual(result!.data);
        expect(serialized).not.toContain("\u001b");
      }
    });
  });
});

describe("the chart family while the workbench switch is off", () => {
  describe("when the platform answers every verb with lwql_not_enabled", () => {
    /** @scenario "Every CLI verb this slice adds refuses while the workbench switch is off, and writes nothing" */
    it("every verb exits non-zero, surfacing the refusal instead of swallowing it", async () => {
      const flagOff = new ChartsApiError(
        "Failed: lwql_not_enabled",
        "workbench switch off",
      );
      mocks.list.mockRejectedValue(flagOff);
      mocks.get.mockRejectedValue(flagOff);
      mocks.create.mockRejectedValue(flagOff);
      mocks.update.mockRejectedValue(flagOff);
      mocks.delete.mockRejectedValue(flagOff);
      mocks.place.mockRejectedValue(flagOff);
      mocks.unplace.mockRejectedValue(flagOff);
      mocks.runQuery.mockRejectedValue(flagOff);

      const attempts: [string, () => Promise<unknown>][] = [
        ["list", () => listChartsCommand()],
        ["get", () => getChartCommand("chart-1")],
        ["create", () => createChartCommand({ name: "x", sql: "SELECT 1" })],
        ["update", () => updateChartCommand("chart-1", { name: "y" })],
        ["delete", () => deleteChartCommand("chart-1")],
        ["run", () => runChartCommand("chart-1", {})],
        [
          "place",
          () => placeChartCommand("chart-1", { dashboardId: "dashboard-1" }),
        ],
        ["unplace", () => unplaceChartCommand("chart-1")],
      ];

      for (const [verb, attempt] of attempts) {
        await expect(attempt(), verb).rejects.toThrow(ProcessExitError);
      }
      // The refusal came from the platform's switch, before any row was
      // written — nothing here retried or fell back to another write path.
      expect(mocks.list).toHaveBeenCalledTimes(1);
      // 2, not 1: the "run" attempt below reads the chart via the same
      // `service.get` before it can execute it, so this method sees one call
      // from the "get" attempt and one from "run"'s internal read.
      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.delete).toHaveBeenCalledTimes(1);
      expect(mocks.place).toHaveBeenCalledTimes(1);
      expect(mocks.unplace).toHaveBeenCalledTimes(1);
    });
  });
});
