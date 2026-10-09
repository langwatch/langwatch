import { describe, expect, it } from "vitest";

import { MemoryTraceIndexMaterialisationRepository } from "../../repositories/memory/memory.trace-index-materialisation.repository.ts";
import { TraceIndexMaterialisationRepository } from "../../repositories/trace-index-materialisation.repository.ts";
import {
  TraceIndexMaterialisationService,
  type UpdatedAtIndexProgress,
} from "../trace-index-materialisation.service.ts";

const running = { mutationId: "mutation_7.txt", isDone: false, partsToDo: 3, latestFailReason: "" };

function harness({
  mutations = MemoryTraceIndexMaterialisationRepository.create(),
}: { mutations?: TraceIndexMaterialisationRepository } = {}) {
  const saved: UpdatedAtIndexProgress[] = [];
  const service = TraceIndexMaterialisationService.create({ mutations, pollIntervalMs: 0 });
  const run = ({
    dryRun = false,
    signal = new AbortController().signal,
    onPoll = async (progress: UpdatedAtIndexProgress) => void saved.push(progress),
  }: {
    dryRun?: boolean;
    signal?: AbortSignal;
    onPoll?: (progress: UpdatedAtIndexProgress) => Promise<void>;
  } = {}) => service.waitForUpdatedAtIndex({ dryRun, signal, onPoll });
  return { saved, run };
}

/** A table without the index: starting the build records no mutation. */
class IndexlessTable extends TraceIndexMaterialisationRepository {
  started = 0;
  async findUpdatedAtIndexMutations() {
    return [];
  }
  async materialiseUpdatedAtIndex() {
    this.started += 1;
  }
}

describe("TraceIndexMaterialisationService", () => {
  /** @scenario "The step finishes once ClickHouse has built the index" */
  it("finishes on a done mutation without starting another", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.record({ ...running, isDone: true, partsToDo: 0 });
    const { run } = harness({ mutations });

    await expect(run()).resolves.toEqual({ mutationId: "mutation_7.txt", partsToDo: 0 });
    expect(mutations.issued()).toBe(0);
  });

  /** @scenario "The step saves progress while the mutation is still running" */
  it("saves each poll until the mutation is done", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.record(running);
    const { saved, run } = harness({ mutations });

    const result = await run({
      onPoll: async (progress) => {
        saved.push(progress);
        const partsToDo = progress.partsToDo - 1;
        mutations.record({ ...running, partsToDo, isDone: partsToDo === 0 });
      },
    });

    expect(saved).toEqual([
      { mutationId: "mutation_7.txt", partsToDo: 3 },
      { mutationId: "mutation_7.txt", partsToDo: 2 },
      { mutationId: "mutation_7.txt", partsToDo: 1 },
    ]);
    expect(result).toEqual({ mutationId: "mutation_7.txt", partsToDo: 0 });
  });

  /** @scenario "The step starts the build once when no mutation is recorded" */
  it("starts the build once and waits on its mutation", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    const { saved, run } = harness({ mutations });

    const result = await run({
      onPoll: async (progress) => {
        saved.push(progress);
        mutations.record({ ...running, mutationId: "mutation_memory_1.txt", isDone: true });
      },
    });

    expect(mutations.issued()).toBe(1);
    expect(saved).toEqual([{ mutationId: "mutation_memory_1.txt", partsToDo: 1 }]);
    expect(result.mutationId).toBe("mutation_memory_1.txt");
  });

  /** @scenario "The step finishes when the table has no such index" */
  it("finishes after one start when no mutation appears", async () => {
    const table = new IndexlessTable();
    const { run } = harness({ mutations: table });

    await expect(run()).resolves.toEqual({ mutationId: null, partsToDo: 0 });
    expect(table.started).toBe(1);
  });

  /** @scenario "A failed mutation fails the step in operator words" */
  it("throws the mutation's failure reason", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.record({ ...running, latestFailReason: "Memory limit exceeded" });
    const { saved, run } = harness({ mutations });

    await expect(run()).rejects.toThrow(/mutation_7\.txt.*Memory limit exceeded/);
    expect(saved).toEqual([]);
  });

  /** @scenario "A dry run reports the remaining parts and changes nothing" */
  it("reports parts left on a dry run, starting and saving nothing", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.record(running);
    const { saved, run } = harness({ mutations });

    await expect(run({ dryRun: true })).resolves.toEqual({
      mutationId: "mutation_7.txt",
      partsToDo: 3,
    });
    expect(saved).toEqual([]);

    const empty = MemoryTraceIndexMaterialisationRepository.create();
    await harness({ mutations: empty }).run({ dryRun: true });
    expect(empty.issued()).toBe(0);
  });

  /** @scenario "The step stops when it is asked to" */
  it("returns the last progress once aborted", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.record(running);
    const { saved, run } = harness({ mutations });
    const controller = new AbortController();

    const result = await run({
      signal: controller.signal,
      onPoll: async (progress) => {
        saved.push(progress);
        controller.abort();
      },
    });

    expect(result).toEqual({ mutationId: "mutation_7.txt", partsToDo: 3 });
    expect(saved).toHaveLength(1);
  });
});
