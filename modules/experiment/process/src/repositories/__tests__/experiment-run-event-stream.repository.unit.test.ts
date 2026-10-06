import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import {
  ExperimentRunEventStreamRepository,
  type ExperimentRunStreamMessage,
} from "../experiment-run-event-stream.repository.ts";
import { MemoryExperimentRunEventStreamRepository } from "../memory/memory.experiment-run-event-stream.repository.ts";
import { RedisExperimentRunEventStreamRepository } from "../redis/redis.experiment-run-event-stream.repository.ts";

const tiers: [string, () => ExperimentRunEventStreamRepository][] = [
  ["memory", () => MemoryExperimentRunEventStreamRepository.create()],
  ["redis", () => RedisExperimentRunEventStreamRepository.create({ redis: memoryRedisDouble() })],
];

const started: ExperimentRunStreamMessage = {
  seq: 1,
  frame: { type: "execution_started", runId: "run_1", total: 2 },
};
const progress: ExperimentRunStreamMessage = {
  seq: 2,
  frame: { type: "progress", completed: 1, total: 2 },
};

describe.each(tiers)("ExperimentRunEventStreamRepository (%s)", (_tier, create) => {
  describe("when a run's frames are published", () => {
    /** @scenario "A run's frames reach the stream that subscribed to the run, and no other" */
    it("delivers them in order to the run's subscriber, and not to another run's", async () => {
      const stream = create();
      const heard: ExperimentRunStreamMessage[] = [];
      const elsewhere: ExperimentRunStreamMessage[] = [];
      await stream.subscribe({ runId: "run_1", onMessage: (message) => heard.push(message) });
      await stream.subscribe({ runId: "run_2", onMessage: (message) => elsewhere.push(message) });

      await stream.publish({ runId: "run_1", ...started });
      await stream.publish({ runId: "run_1", ...progress });

      expect(heard).toEqual([started, progress]);
      expect(elsewhere).toEqual([]);
      stream.close();
    });

    it("delivers them to every stream open on the run", async () => {
      const stream = create();
      const first: ExperimentRunStreamMessage[] = [];
      const second: ExperimentRunStreamMessage[] = [];
      await stream.subscribe({ runId: "run_1", onMessage: (message) => first.push(message) });
      await stream.subscribe({ runId: "run_1", onMessage: (message) => second.push(message) });

      await stream.publish({ runId: "run_1", ...started });

      expect(first).toEqual([started]);
      expect(second).toEqual([started]);
      stream.close();
    });
  });

  describe("when a stream unsubscribes", () => {
    it("hears nothing further while the run's other stream still does", async () => {
      const stream = create();
      const gone: ExperimentRunStreamMessage[] = [];
      const kept: ExperimentRunStreamMessage[] = [];
      const unsubscribe = await stream.subscribe({
        runId: "run_1",
        onMessage: (message) => gone.push(message),
      });
      await stream.subscribe({ runId: "run_1", onMessage: (message) => kept.push(message) });

      await unsubscribe();
      await stream.publish({ runId: "run_1", ...started });

      expect(gone).toEqual([]);
      expect(kept).toEqual([started]);
      stream.close();
    });
  });
});

describe("RedisExperimentRunEventStreamRepository", () => {
  describe("when a frame is published", () => {
    it("writes `{ seq, frame }` on the run's channel", async () => {
      const published: { channel: string; message: string }[] = [];
      const redis = memoryRedisDouble({
        script: {
          publish: async (channel: unknown, message: unknown) => {
            published.push({ channel: String(channel), message: String(message) });
            return 0;
          },
        },
      });
      const stream = RedisExperimentRunEventStreamRepository.create({ redis });

      await stream.publish({ runId: "run_1", ...started });

      expect(published).toEqual([
        { channel: "experiment_run:run_1", message: JSON.stringify(started) },
      ]);
    });
  });

  describe("when a malformed message arrives on a run's channel", () => {
    it("drops it and keeps delivering the frames after it", async () => {
      const redis = memoryRedisDouble();
      const stream = RedisExperimentRunEventStreamRepository.create({ redis });
      const heard: ExperimentRunStreamMessage[] = [];
      await stream.subscribe({ runId: "run_1", onMessage: (message) => heard.push(message) });

      await redis.publish(ExperimentRunEventStreamRepository.channelFor("run_1"), "not json");
      await redis.publish(ExperimentRunEventStreamRepository.channelFor("run_1"), '{"seq":-1}');
      await stream.publish({ runId: "run_1", ...started });

      expect(heard).toEqual([started]);
      stream.close();
    });
  });
});
