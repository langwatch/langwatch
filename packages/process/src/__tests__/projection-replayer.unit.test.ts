/**
 * The projection replayer a module's `.withMigrations` setup receives: the process's own, built
 * over the engine its eventing member opens per run (Alex, 2026-10-07, round 12).
 */
import type { ProjectionLaneReplayer, ReplayService } from "@langwatch/eventing";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { defineProcessModule } from "../feature-installer.ts";
import { processProjectionReplayer } from "../projection-replayer.ts";
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

const REPLAY = { lane: "directoryMembers", since: "1970-01-01T00:00:00Z", dryRun: false };

async function replayerHandedTo({
  composed,
}: {
  composed: ProjectionLaneReplayer | undefined;
}): Promise<ProjectionLaneReplayer> {
  let handed: ProjectionLaneReplayer | undefined;
  const declaration = defineProcessModule("dataset")
    .withApi(DatasetModule)
    .withTransports()
    .withMigrations(({ replayer }) => {
      handed = replayer;
      return [];
    });
  await declaration.install({
    resources: new ResourceScope(),
    config: undefined,
    members: {} as never,
    role: "worker",
    ...(composed === undefined ? {} : { replayer: composed }),
    resolve: () => undefined,
  });
  if (handed === undefined) throw new Error("the migration binder never ran");
  return handed;
}

function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => {
      throw new Error("expected the replay to refuse");
    },
    (error: unknown) => error,
  );
}

describe("given a module that declares its migration steps", () => {
  describe("when the process composed a projection replayer", () => {
    /** @scenario "A module's migration binder receives the process's projection replayer" */
    it("hands that replayer to the module's migration binder", async () => {
      const composed = processProjectionReplayer({ eventing: undefined });

      expect(await replayerHandedTo({ composed })).toBe(composed);
    });
  });

  describe("when the module is installed with no replayer composed", () => {
    /** @scenario "A projection replay in a process whose eventing opens no replay engine is refused by code" */
    it("hands a replayer that refuses by code instead of nothing", async () => {
      const handed = await replayerHandedTo({ composed: undefined });

      const error = await refusalOf(() => handed.replayLane(REPLAY));

      expect(error).toMatchObject({ code: "projection_replay_unavailable", lane: REPLAY.lane });
    });
  });
});

describe("given the process's eventing member", () => {
  describe("when it opens a replay engine", () => {
    /** @scenario "The process's projection replayer replays over its eventing member's engine and closes it" */
    it("replays through eventing's lane replayer and closes the engine after the run", async () => {
      const closed = { count: 0 };
      const replayer = processProjectionReplayer({
        eventing: {
          definitions: [],
          replayEngine: () => ({
            service: {} as ReplayService,
            close: async () => {
              closed.count += 1;
            },
          }),
        },
      });

      const error = await refusalOf(() => replayer.replayLane(REPLAY));

      expect(error).toMatchObject({ code: "projection_lane_not_found" });
      expect(closed.count).toBe(1);
    });
  });

  describe("when it opens no replay engine", () => {
    /** @scenario "A projection replay in a process whose eventing opens no replay engine is refused by code" */
    it("refuses by code naming the lane", async () => {
      const replayer = processProjectionReplayer({ eventing: { definitions: [] } });

      const error = await refusalOf(() => replayer.replayLane(REPLAY));

      expect(error).toMatchObject({ code: "projection_replay_unavailable", lane: REPLAY.lane });
    });
  });
});
