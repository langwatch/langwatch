/**
 * @vitest-environment node
 * The cancellation hint answers alike over its memory twin and its Redis key.
 * Spec: modules/instant-eval/specs/instant-eval-pipeline.feature
 */
import { describe, expect, it } from "vitest";

import type { InstantEvalCancellationRepository } from "../instant-eval-cancellation.repository.ts";
import { MemoryInstantEvalCancellationRepository } from "../memory/memory.instant-eval.repositories.ts";
import {
  type InstantEvalCancellationRedis,
  RedisInstantEvalCancellationRepository,
} from "../redis/redis.instant-eval-cancellation.repository.ts";

/** The two Redis calls the repository makes, over a map. */
function keyedRedis(): InstantEvalCancellationRedis {
  const keys = new Set<string>();
  return {
    set: async (key) => keys.add(key),
    exists: async (key) => (keys.has(key) ? 1 : 0),
  };
}

function contractCases(makeRepository: () => InstantEvalCancellationRepository): void {
  it("reads a run nobody asked to stop as not requested", async () => {
    await expect(makeRepository().isRequested({ runId: "run-1" })).resolves.toBe(false);
  });

  it("reads a run asked to stop as requested", async () => {
    const repository = makeRepository();

    await repository.request({ runId: "run-1" });

    await expect(repository.isRequested({ runId: "run-1" })).resolves.toBe(true);
  });

  it("keeps the hint to the run it was written for", async () => {
    const repository = makeRepository();

    await repository.request({ runId: "run-1" });

    await expect(repository.isRequested({ runId: "run-2" })).resolves.toBe(false);
  });

  it("answers the same when the hint is written twice", async () => {
    const repository = makeRepository();

    await repository.request({ runId: "run-1" });
    await repository.request({ runId: "run-1" });

    await expect(repository.isRequested({ runId: "run-1" })).resolves.toBe(true);
  });
}

describe("given the instant-eval memory cancellation repository", () => {
  contractCases(() => MemoryInstantEvalCancellationRepository.create());
});

describe("given the instant-eval Redis cancellation repository", () => {
  contractCases(() => RedisInstantEvalCancellationRepository.create(keyedRedis()));
});
