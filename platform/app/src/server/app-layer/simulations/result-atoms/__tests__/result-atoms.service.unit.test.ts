/**
 * @see specs/features/agent-testing/results-atoms.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import type { ResultsFilter } from "../atom.types";
import type {
  RawAtomRow,
  RawGroupRow,
  RawTrendRow,
  ResultAtomsClickHouseRepository,
} from "../result-atoms.clickhouse.repository";
import {
  bucketSecondsFor,
  ResultAtomsService,
  rate,
} from "../result-atoms.service";

const now = Date.UTC(2026, 1, 15);
const startDate = now - 30 * 24 * 60 * 60 * 1000;

const filter: ResultsFilter = { projectId: "proj", startDate, endDate: now };

interface FakeData {
  groups?: RawGroupRow[];
  trend?: RawTrendRow[];
  atoms?: RawAtomRow[];
  series?: { Bucket: string; Passed: string; Settled: string }[];
  totals?: Record<string, string> | null;
  codeTargets?: { TargetKey: string; Name: string }[];
}

function makeRepo(data: FakeData) {
  return {
    aggregateTotals: vi.fn().mockResolvedValue(
      data.totals === undefined
        ? {
            Atoms: "0",
            Passed: "0",
            Settled: "0",
            RunCount: "0",
            FailingScenarios: "0",
            CostTotal: "0",
            CostUnknown: "0",
          }
        : data.totals,
    ),
    aggregateGroups: vi.fn().mockResolvedValue(data.groups ?? []),
    aggregateTrend: vi.fn().mockResolvedValue(data.trend ?? []),
    aggregateSeries: vi.fn().mockResolvedValue(data.series ?? []),
    findAtoms: vi
      .fn()
      .mockResolvedValue({ atoms: data.atoms ?? [], hasMore: false }),
    findRunOrdinals: vi.fn().mockResolvedValue([]),
    findCodeScenarios: vi.fn().mockResolvedValue([]),
    findCodeTargets: vi.fn().mockResolvedValue(data.codeTargets ?? []),
  } as unknown as ResultAtomsClickHouseRepository;
}

function makePrisma({
  suites = [],
  scenarios = [],
}: {
  suites?: { id: string; name: string; slug: string }[];
  scenarios?: { id: string; name: string; labels: string[] }[];
} = {}) {
  return {
    simulationSuite: { findMany: vi.fn().mockResolvedValue(suites) },
    scenario: { findMany: vi.fn().mockResolvedValue(scenarios) },
  } as unknown as PrismaClient;
}

const group = (over: Partial<RawGroupRow> = {}): RawGroupRow => ({
  GroupKey: "key",
  Name: "",
  TargetName: "",
  Atoms: "2",
  Passed: "1",
  Settled: "2",
  RunCount: "1",
  ScenarioCount: "2",
  LastRunAt: String(now),
  TargetKeys: ["agent_dev"],
  CostTotal: "0.5",
  CostUnknown: "0",
  ...over,
});

describe("getOverview", () => {
  describe("when grouping by run plan and a plan did not run in the window", () => {
    /**
     * The person who opens this page to check on a plan they are worried about
     * is exactly the person whose plan has been quiet, so dropping it is the
     * opposite of what they came for.
     */
    /** @scenario "The overview groups by run plan" */
    it("still lists the plan, reading as nothing in the period", async () => {
      const ranSuite = { id: "suite-ran", name: "Checkout", slug: "checkout" };
      const quietSuite = {
        id: "suite-quiet",
        name: "Refunds",
        slug: "refunds",
      };
      const service = new ResultAtomsService(
        makeRepo({
          groups: [group({ GroupKey: getSuiteSetId(ranSuite.id) })],
        }),
        makePrisma({ suites: [ranSuite, quietSuite] }),
      );

      const overview = await service.getOverview({ filter, groupBy: "plan" });

      const byKey = new Map(overview.groups.map((one) => [one.key, one]));
      expect(byKey.get("checkout")?.title).toBe("Checkout");
      expect(byKey.get("refunds")).toMatchObject({
        title: "Refunds",
        runCount: 0,
        scenarioCount: 0,
        passRate: null,
        lastRunAt: null,
        trend: [],
        cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
      });
    });
  });

  describe("when a group has settled nothing", () => {
    /**
     * Null and zero are different colours. Coercing an unsettled group to zero
     * paints a run that is still going as one that failed outright.
     */
    it("reports its pass rate as null rather than as zero", async () => {
      const service = new ResultAtomsService(
        makeRepo({ groups: [group({ Passed: "0", Settled: "0" })] }),
        makePrisma(),
      );

      const overview = await service.getOverview({ filter, groupBy: "target" });

      expect(overview.groups[0]?.passRate).toBeNull();
    });
  });

  describe("the cost of a group", () => {
    /**
     * The denominator is given, never inferred, so the page can say "across 4
     * of 6 runs" instead of printing a total that looks complete.
     */
    /** @scenario "The overview says how many atoms have no known cost" */
    it("states its own coverage alongside the total", async () => {
      const service = new ResultAtomsService(
        makeRepo({
          groups: [group({ Atoms: "6", CostTotal: "1.25", CostUnknown: "2" })],
        }),
        makePrisma(),
      );

      const overview = await service.getOverview({ filter, groupBy: "target" });

      expect(overview.groups[0]?.cost).toEqual({
        totalUsd: 1.25,
        knownAtoms: 4,
        unknownAtoms: 2,
      });
    });
  });

  describe("the trend of a group", () => {
    /** @scenario "A group carries one trend point per run" */
    it("reads oldest first", async () => {
      const trend: RawTrendRow[] = [
        {
          GroupKey: "key",
          TrendKey: "b3",
          RunAt: "300",
          Passed: "0",
          Settled: "1",
        },
        {
          GroupKey: "key",
          TrendKey: "b1",
          RunAt: "100",
          Passed: "1",
          Settled: "1",
        },
        {
          GroupKey: "key",
          TrendKey: "b2",
          RunAt: "200",
          Passed: "1",
          Settled: "2",
        },
      ];
      const service = new ResultAtomsService(
        makeRepo({ groups: [group()], trend }),
        makePrisma(),
      );

      const overview = await service.getOverview({ filter, groupBy: "target" });

      expect(overview.groups[0]?.trend.map((point) => point.key)).toEqual([
        "b1",
        "b2",
        "b3",
      ]);
      expect(overview.groups[0]?.trend[0]?.passRate).toBe(100);
      expect(overview.groups[0]?.trend[1]?.passRate).toBe(50);
    });

    describe("when a group holds more points than a sparkline draws", () => {
      /**
       * A sparkline is read to see where a plan is heading, so when something
       * has to go it is the distant past.
       */
      it("keeps the most recent, still oldest first", async () => {
        const trend: RawTrendRow[] = Array.from({ length: 20 }, (_, index) => ({
          GroupKey: "key",
          TrendKey: `b${String(index).padStart(2, "0")}`,
          RunAt: String(index * 100),
          Passed: "1",
          Settled: "1",
        }));
        const service = new ResultAtomsService(
          makeRepo({ groups: [group()], trend }),
          makePrisma(),
        );

        const overview = await service.getOverview({
          filter,
          groupBy: "target",
        });
        const keys = overview.groups[0]?.trend.map((point) => point.key) ?? [];

        expect(keys).toHaveLength(14);
        expect(keys[0]).toBe("b06");
        expect(keys[13]).toBe("b19");
      });
    });
  });

  describe("the pass-rate-over-time series", () => {
    /**
     * A bucket nothing ran in is returned as empty, so the chart draws a gap. A
     * zero-height bar there would read as a run in which everything failed.
     */
    it("returns every bucket in the window, marking the empty ones", async () => {
      const dayStart = Date.UTC(2026, 1, 10);
      const service = new ResultAtomsService(
        makeRepo({
          series: [{ Bucket: String(dayStart), Passed: "1", Settled: "2" }],
        }),
        makePrisma(),
      );

      const overview = await service.getOverview({
        filter: { projectId: "proj", startDate, endDate: now },
        groupBy: "target",
      });

      const filled = overview.totals.series.filter((one) => !one.isEmpty);
      expect(filled).toHaveLength(1);
      expect(filled[0]?.passRate).toBe(50);
      expect(overview.totals.series.length).toBeGreaterThan(25);
      expect(
        overview.totals.series.every(
          (one) => !one.isEmpty || one.passRate === null,
        ),
      ).toBe(true);
    });
  });

  describe("when the filter names a label", () => {
    /**
     * Labels live in Postgres and the run row carries none, so they are turned
     * into scenario ids before the query runs.
     */
    /** @scenario "A filter on labels keeps only scenarios carrying a label" */
    it("resolves it to the scenarios that carry it", async () => {
      const repo = makeRepo({});
      const prisma = makePrisma({
        scenarios: [{ id: "scen-1", name: "Refund", labels: ["checkout"] }],
      });
      const service = new ResultAtomsService(repo, prisma);

      await service.getOverview({
        filter: { ...filter, labels: ["checkout"] },
        groupBy: "scenario",
      });

      expect(repo.aggregateGroups).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ scenarioIds: ["scen-1"] }),
        }),
      );
    });

    describe("and also names a scenario the label does not cover", () => {
      /**
       * Two filters both narrow. A union would widen the page when a person
       * added a second condition, which is the opposite of what they asked.
       */
      it("intersects them rather than widening", async () => {
        const repo = makeRepo({});
        const prisma = makePrisma({
          scenarios: [{ id: "scen-1", name: "Refund", labels: ["checkout"] }],
        });
        const service = new ResultAtomsService(repo, prisma);

        await service.getOverview({
          filter: { ...filter, labels: ["checkout"], scenarioIds: ["scen-2"] },
          groupBy: "scenario",
        });

        expect(repo.aggregateGroups).toHaveBeenCalledWith(
          expect.objectContaining({
            filter: expect.objectContaining({ scenarioIds: [] }),
          }),
        );
      });
    });
  });

  describe("when grouping by scenario", () => {
    /** @scenario "The overview groups by scenario" */
    it("names each group after its scenario and lists its labels", async () => {
      const service = new ResultAtomsService(
        makeRepo({ groups: [group({ GroupKey: "scen-1" })] }),
        makePrisma({
          scenarios: [
            { id: "scen-1", name: "Refund flow", labels: ["checkout", "beta"] },
          ],
        }),
      );

      const overview = await service.getOverview({
        filter,
        groupBy: "scenario",
      });

      expect(overview.groups[0]).toMatchObject({
        key: "scen-1",
        title: "Refund flow",
        subtitle: "checkout, beta",
      });
    });

    /** @scenario "A group of runs pushed from code reads the name its runs carried" */
    it("names a group the project holds no scenario for after the name its runs carried", async () => {
      const service = new ResultAtomsService(
        makeRepo({
          groups: [
            group({ GroupKey: "default-list-agents", Name: "List agents" }),
          ],
        }),
        makePrisma({ scenarios: [] }),
      );

      const overview = await service.getOverview({
        filter,
        groupBy: "scenario",
      });

      expect(overview.groups[0]).toMatchObject({
        key: "default-list-agents",
        title: "List agents",
        subtitle: null,
      });
    });
  });
});

describe("getCodeTargets", () => {
  describe("given a target a run from code named", () => {
    /** @scenario "The targets named by runs from code are listed for the filter" */
    it("lists it under the name the run reported", async () => {
      const service = new ResultAtomsService(
        makeRepo({
          codeTargets: [
            { TargetKey: "code:acmesupportagent", Name: "AcmeSupportAgent" },
          ],
        }),
        makePrisma(),
      );

      const targets = await service.getCodeTargets({
        projectId: "proj",
        startDate,
      });

      expect(targets).toEqual([
        { key: "code:acmesupportagent", name: "AcmeSupportAgent" },
      ]);
    });
  });
});

describe("getAtoms", () => {
  describe("given an atom whose cost was never measured", () => {
    /**
     * The empty string is the one value that means "never measured". Zero is a
     * real answer and must not be confused with it.
     */
    it("returns no number for it and names the source as unknown", async () => {
      const row: RawAtomRow = {
        SetId: "set-1",
        BatchRunId: "batch-1",
        ScenarioRunId: "run-1",
        ScenarioId: "scen-1",
        ScenarioKey: "scen-1",
        ScenarioName: "",
        Status: "SUCCESS",
        Outcome: "passed",
        RunAt: String(now),
        DurationMs: "",
        Note: "",
        TargetKey: "unknown",
        TargetName: "",
        Trigger: "code",
        CostUsd: "",
        CostSource: "unknown",
        SortKey: String(now),
      };
      const service = new ResultAtomsService(
        makeRepo({ atoms: [row] }),
        makePrisma(),
      );

      const { atoms } = await service.getAtoms({ filter, limit: 10 });

      expect(atoms[0]?.costUsd).toBeNull();
      expect(atoms[0]?.costSource).toBe("unknown");
      expect(atoms[0]?.note).toBeNull();
      expect(atoms[0]?.durationMs).toBeNull();
    });
  });
});

describe("the target of a group", () => {
  describe("when a run from code reported the agent it tested", () => {
    /** @scenario "Two runs of one agent name fold under one target" */
    it("reads the group under that agent name", async () => {
      const service = new ResultAtomsService(
        makeRepo({
          groups: [
            group({
              GroupKey: "code:acmesupportagent",
              TargetName: "AcmeSupportAgent",
              RunCount: "2",
            }),
          ],
        }),
        makePrisma(),
      );

      const overview = await service.getOverview({ filter, groupBy: "target" });

      expect(overview.groups).toHaveLength(1);
      expect(overview.groups[0]).toMatchObject({
        key: "code:acmesupportagent",
        title: "AcmeSupportAgent",
      });
    });
  });

  describe("when the run reported no agent", () => {
    /**
     * The client names a platform reference id from its own target map, so a
     * group that reported nothing has to keep its key as its title.
     */
    it("keeps the key as the title", async () => {
      const service = new ResultAtomsService(
        makeRepo({ groups: [group({ GroupKey: "agent_dev" })] }),
        makePrisma(),
      );

      const overview = await service.getOverview({ filter, groupBy: "target" });

      expect(overview.groups[0]?.title).toBe("agent_dev");
    });
  });
});

describe("rate", () => {
  describe("when nothing settled", () => {
    it("is null, not zero", () => {
      expect(rate(0, 0)).toBeNull();
    });
  });

  describe("when everything settled and passed", () => {
    it("is a hundred", () => {
      expect(rate(3, 3)).toBe(100);
    });
  });
});

describe("bucketSecondsFor", () => {
  describe("given a window a person reads in hours", () => {
    it("buckets by the hour", () => {
      expect(
        bucketSecondsFor({ startDate: now - 24 * 3600_000, endDate: now }),
      ).toBe(3600);
    });
  });

  describe("given a month", () => {
    it("buckets by the day", () => {
      expect(
        bucketSecondsFor({ startDate: now - 30 * 86400_000, endDate: now }),
      ).toBe(86400);
    });
  });

  describe("given a year", () => {
    it("buckets by the week", () => {
      expect(
        bucketSecondsFor({ startDate: now - 365 * 86400_000, endDate: now }),
      ).toBe(7 * 86400);
    });
  });
});

describe("the shape of an atom", () => {
  describe("given a scenario that sits in a suite and carries labels", () => {
    /** @scenario "An atom names its scenario and leaves the folder and the labels out" */
    it("names the scenario and carries neither the folder nor the labels", async () => {
      const service = new ResultAtomsService(
        makeRepo({
          atoms: [
            {
              SetId: getSuiteSetId("suite-1"),
              BatchRunId: "batch-1",
              ScenarioRunId: "run-1",
              ScenarioId: "scen-1",
              ScenarioKey: "scen-1",
              ScenarioName: "",
              Status: "SUCCESS",
              Outcome: "passed",
              RunAt: String(now),
              DurationMs: "1500",
              Note: "",
              TargetKey: "agent_dev",
              TargetName: "",
              Trigger: "app",
              CostUsd: "0.01",
              CostSource: "run",
              SortKey: String(now),
            },
          ],
        }),
        makePrisma({
          suites: [{ id: "suite-1", name: "Refunds", slug: "refunds" }],
          scenarios: [
            { id: "scen-1", name: "Refund flow", labels: ["checkout", "beta"] },
          ],
        }),
      );

      const page = await service.getAtoms({ filter, limit: 10 });
      const atom = page.atoms[0]!;

      expect(atom.scenarioId).toBe("scen-1");
      expect(atom).not.toHaveProperty("folderId");
      expect(atom).not.toHaveProperty("labels");
    });
  });
});
