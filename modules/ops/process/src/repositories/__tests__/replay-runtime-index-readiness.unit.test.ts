/**
 * @vitest-environment node
 * Ops' replay runtimes check the event log's aggregate index only once a runtime is built, which
 * only the worker executing a replay does: the api never sends the check (ADR-202 Decided 3).
 * @see modules/ops/specs/projection-replay-console.feature
 */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import type * as Eventing from "@langwatch/eventing";
import type { ReplayEventSource, RetentionPolicyResolver } from "@langwatch/eventing";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/eventing", async (importOriginal) => {
  const original = await importOriginal<typeof Eventing>();
  return {
    ...original,
    upcastReplayEventSource: ({ source }: { source: ReplayEventSource }) => source,
    ReplayService: class {},
  };
});

const { LiveReplayRuntimeRepository } = await import("../live/live.replay-runtime.repository.ts");

const retention: RetentionPolicyResolver = { resolve: () => Promise.reject(new Error("unused")) };

function repositoryOver({ sent }: { sent: QueryRequest[] }) {
  return LiveReplayRuntimeRepository.create({
    redis: redisDouble({ isCluster: false, duplicate: () => redisDouble({}) }),
    clickhouse: clickHouseQueryClientDouble({
      privateRoutes: () => new Map(),
      query: (request: QueryRequest) => {
        sent.push(request);
        return Promise.resolve({ rows: [] });
      },
    }),
    eventing: { definitions: [] },
  });
}

describe("given ops' live replay runtime repository", () => {
  describe("when every role builds it with its ops repositories", () => {
    /** @scenario "Only the worker building a replay runtime checks the event log's index" */
    it("sends no statement until a runtime is built", async () => {
      const sent: QueryRequest[] = [];
      repositoryOver({ sent });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sent).toEqual([]);
    });
  });

  describe("when the worker builds a runtime", () => {
    /** @scenario "Only the worker building a replay runtime checks the event log's index" */
    it("checks the index on the system identity", async () => {
      const sent: QueryRequest[] = [];
      repositoryOver({ sent }).create({ retention });

      await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
      expect(sent.every((request) => request.SKIP_TENANT_CHECK === true)).toBe(true);
    });
  });
});
