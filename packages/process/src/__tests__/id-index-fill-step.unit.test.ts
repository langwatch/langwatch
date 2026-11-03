/**
 * What a module's `.withIdIndexes(...)` contributes at install: its declarations on the live
 * ClickHouse client, and one background fill step under the module's own step id.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { type ClickHouseQueryClient, defineIdIndex } from "@langwatch/clickhouse-client";
import { idIndexedClientDouble } from "@langwatch/clickhouse-client/testing";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { defineProcessModule, type InstalledFeatureState } from "../feature-installer.ts";
import {
  type IdIndexFillStep,
  IdIndexRetentionUnavailableError,
} from "../migration/id-index-fill-step.ts";
import { ResourceScope } from "../resource-scope.ts";

interface DatasetApi {
  label(): string;
}
const DatasetApi = moduleApi<DatasetApi>()("dataset");

class DatasetModule implements DatasetApi {
  static readonly contract = DatasetApi;
  static readonly dependencies = {};
  static create(): DatasetModule {
    return new DatasetModule();
  }
  label(): string {
    return "dataset";
  }
}

const RUNS = defineIdIndex({ source: "dataset_runs", key: ["RunId"], time: "StartedAt" });

const isFillStep = (value: unknown): value is IdIndexFillStep =>
  typeof value === "object" && value !== null && "run" in value && "id" in value;

const emptyClient = (): ClickHouseQueryClient =>
  idIndexedClientDouble({ indexes: [], driver: { execute: async () => ({ rows: [] }) } });

async function install({
  tier,
  clickhouse,
}: {
  tier: "live" | "memory";
  clickhouse?: ClickHouseQueryClient;
}): Promise<InstalledFeatureState> {
  const declaration = defineProcessModule("dataset")
    .withApi(DatasetModule)
    .withTransports()
    .withIdIndexes([RUNS], { after: ["trace:fill-id-indexes"] });
  return declaration.install({
    resources: new ResourceScope(),
    config: undefined,
    role: "tasks",
    repositorySelection: { tier, members: clickhouse === undefined ? {} : { clickhouse } },
    resolve: () => undefined,
  });
}

const fillStepOf = (state: InstalledFeatureState): IdIndexFillStep => {
  const [step] = (state.migrationSteps ?? []).filter(isFillStep);
  if (step === undefined) throw new Error("no fill step was built");
  return step;
};

const checkpoint = { resumeFrom: null, save: async (): Promise<void> => {} };

describe("given a module that declares its id indexes once", () => {
  describe("when a live process installs it", () => {
    /** @scenario "a module declares its id indexes once and the framework fills them" */
    it("declares them on the client and builds one fill step under the module's id", async () => {
      const clickhouse = emptyClient();

      const state = await install({ tier: "live", clickhouse });

      expect(
        clickhouse.idIndexes().declarationOf({ source: "dataset_runs", key: ["RunId"] }),
      ).toEqual(RUNS);
      const step = fillStepOf(state);
      expect(step).toMatchObject({
        id: "dataset:fill-id-indexes",
        kind: "data",
        mode: "background",
        needsOldWritersGone: false,
        after: ["trace:fill-id-indexes"],
      });
    });

    it("refuses to fill without the composed retention raise, which would lose retention", async () => {
      const clickhouse = emptyClient();
      const step = fillStepOf(await install({ tier: "live", clickhouse }));

      await expect(
        step.run({ checkpoint, dryRun: false, signal: new AbortController().signal }),
      ).rejects.toBeInstanceOf(IdIndexRetentionUnavailableError);
    });
  });

  describe("when a process over memory stores installs it", () => {
    it("fills nothing, since memory holds no ClickHouse", async () => {
      const step = fillStepOf(await install({ tier: "memory" }));

      const report = await step.run({
        checkpoint,
        dryRun: false,
        signal: new AbortController().signal,
      });

      expect(report).toMatchObject({ done: 0, total: 0, batches: 0 });
    });
  });
});
