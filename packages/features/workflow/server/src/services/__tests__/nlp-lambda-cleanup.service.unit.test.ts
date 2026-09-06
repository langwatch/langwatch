import { describe, expect, it } from "vitest";
import { NlpLambdaFleetPort, type NlpLambdaFunction } from "../../ports/nlp-lambda-fleet.port.ts";
import { NlpLambdaCleanupService } from "../nlp-lambda-cleanup.service.ts";

const NOW = new Date("2026-09-05T00:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

class FakeFleet extends NlpLambdaFleetPort {
  readonly deletedFunctions: string[] = [];
  readonly deletedLogGroups: string[] = [];

  constructor(
    private readonly functions: readonly string[],
    private readonly activity: Readonly<Record<string, Date | null>>,
    private readonly logGroups: readonly string[] = [],
  ) {
    super();
  }

  async listFunctions(): Promise<readonly NlpLambdaFunction[]> {
    return this.functions.map((name) => ({ name }));
  }

  async tryReadLastActivityAt({ functionName }: { functionName: string }): Promise<Date | null> {
    return this.activity[functionName] ?? null;
  }

  async functionExists({ functionName }: { functionName: string }): Promise<boolean> {
    return this.functions.includes(functionName);
  }

  async deleteFunction({ functionName }: { functionName: string }): Promise<void> {
    this.deletedFunctions.push(functionName);
  }

  async listLogGroups(): Promise<readonly string[]> {
    return this.logGroups;
  }

  async deleteLogGroup({ functionName }: { functionName: string }): Promise<void> {
    this.deletedLogGroups.push(functionName);
  }
}

const sweep = (fleet: FakeFleet) =>
  NlpLambdaCleanupService.create({ fleet, now: () => NOW }).sweep();

describe("NlpLambdaCleanupService", () => {
  describe("given a function idle for more than a week", () => {
    describe("when the sweep runs", () => {
      it("deletes the function but keeps its log group", async () => {
        const fleet = new FakeFleet(["langwatch_nlp-quiet"], {
          "langwatch_nlp-quiet": daysAgo(30),
        });

        const report = await sweep(fleet);

        expect(fleet.deletedFunctions).toEqual(["langwatch_nlp-quiet"]);
        expect(fleet.deletedLogGroups).toEqual([]);
        expect(report.functionsDeleted).toBe(1);
      });
    });
  });

  describe("given a function used within the week", () => {
    describe("when the sweep runs", () => {
      it("leaves it alone", async () => {
        const fleet = new FakeFleet(["langwatch_nlp-busy"], {
          "langwatch_nlp-busy": daysAgo(2),
        });

        await sweep(fleet);

        expect(fleet.deletedFunctions).toEqual([]);
      });
    });
  });

  describe("given a function idle for over a year", () => {
    describe("when the sweep runs", () => {
      it("deletes the log group as well as the function", async () => {
        const fleet = new FakeFleet(["langwatch_nlp-ancient"], {
          "langwatch_nlp-ancient": daysAgo(400),
        });

        await sweep(fleet);

        expect(fleet.deletedFunctions).toEqual(["langwatch_nlp-ancient"]);
        expect(fleet.deletedLogGroups).toEqual(["langwatch_nlp-ancient"]);
      });
    });
  });

  describe("given a function whose last activity cannot be read", () => {
    describe("when the sweep runs", () => {
      // Unknown is not unused: a missing log group would otherwise delete a
      // live project's engine.
      it("keeps it and reports the skip", async () => {
        const fleet = new FakeFleet(["langwatch_nlp-unknown"], {});

        const report = await sweep(fleet);

        expect(fleet.deletedFunctions).toEqual([]);
        expect(report.skippedUnknownActivity).toBe(1);
      });
    });
  });

  describe("given an orphaned log group whose function is gone", () => {
    describe("when the sweep runs", () => {
      it("deletes it only once it is past the year cutoff", async () => {
        const recent = new FakeFleet([], { "langwatch_nlp-orphan": daysAgo(30) }, [
          "langwatch_nlp-orphan",
        ]);
        const ancient = new FakeFleet([], { "langwatch_nlp-orphan": daysAgo(400) }, [
          "langwatch_nlp-orphan",
        ]);

        await sweep(recent);
        await sweep(ancient);

        expect(recent.deletedLogGroups).toEqual([]);
        expect(ancient.deletedLogGroups).toEqual(["langwatch_nlp-orphan"]);
      });
    });
  });
});
