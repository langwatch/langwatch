import { describe, expect, it } from "vitest";

import { MemoryTraceIndexMaterialisationRepository } from "../../repositories/memory/memory.trace-index-materialisation.repository.ts";
import { TraceIndexMaterialisationRepository } from "../../repositories/trace-index-materialisation.repository.ts";
import {
  materialisationProgressSchema,
  TraceIndexMaterialisationService,
  type MaterialisationProgress,
} from "../trace-index-materialisation.service.ts";

const running = { mutationId: "mutation_7.txt", isDone: false, partsToDo: 3, latestFailReason: "" };

function harness({
  mutations = MemoryTraceIndexMaterialisationRepository.create(),
}: { mutations?: TraceIndexMaterialisationRepository } = {}) {
  const saved: MaterialisationProgress[] = [];
  const service = TraceIndexMaterialisationService.create({ mutations, pollIntervalMs: 0 });
  const run = ({
    dryRun = false,
    signal = new AbortController().signal,
    onPoll = async (progress: MaterialisationProgress) => void saved.push(progress),
  }: {
    dryRun?: boolean;
    signal?: AbortSignal;
    onPoll?: (progress: MaterialisationProgress) => Promise<void>;
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
  async findAnalyticsMetadataColumnMutations() {
    return [];
  }
  async countPartsMissingAnalyticsMetadataColumns() {
    return 1;
  }
  async materialiseAnalyticsMetadataColumns() {
    this.started += 1;
  }
}

/** A table whose started column mutation is not listed yet; its parts store them by check 3. */
class UnlistedColumnsTable extends IndexlessTable {
  checks = 0;
  override async countPartsMissingAnalyticsMetadataColumns() {
    this.checks += 1;
    return this.checks < 3 ? 2 : 0;
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
    expect(saved).toEqual([
      { mutationId: null, partsToDo: 0 },
      { mutationId: "mutation_memory_1.txt", partsToDo: 1 },
    ]);
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

  /** @scenario "A background step aborted before it polls starts no ClickHouse mutation" */
  it("starts no build and saves nothing when aborted before the first poll", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    const { saved, run } = harness({ mutations });
    const controller = new AbortController();
    controller.abort();

    await expect(run({ signal: controller.signal })).resolves.toEqual({
      mutationId: null,
      partsToDo: 0,
    });
    expect(mutations.issued()).toBe(0);
    expect(saved).toEqual([]);
  });
});

describe("TraceIndexMaterialisationService, for the trace analytics metadata columns", () => {
  function metadataHarness(mutations: MemoryTraceIndexMaterialisationRepository) {
    const saved: MaterialisationProgress[] = [];
    const service = TraceIndexMaterialisationService.create({ mutations, pollIntervalMs: 0 });
    const run = ({
      onPoll = async (progress: MaterialisationProgress) => void saved.push(progress),
    }: { onPoll?: (progress: MaterialisationProgress) => Promise<void> } = {}) =>
      service.waitForAnalyticsMetadataColumns({
        dryRun: false,
        resumed: false,
        signal: new AbortController().signal,
        onPoll,
      });
    return { saved, run };
  }

  /** @scenario "The step finishes once ClickHouse has stored the metadata columns" */
  it("finishes on a done mutation without starting another or touching the index", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.recordAnalyticsMetadataColumns({ ...running, isDone: true, partsToDo: 0 });
    const { run } = metadataHarness(mutations);

    await expect(run()).resolves.toEqual({ mutationId: "mutation_7.txt", partsToDo: 0 });
    expect(mutations.issuedAnalyticsMetadataColumns()).toBe(0);
    expect(mutations.issued()).toBe(0);
  });

  /** @scenario "The step starts storing the metadata columns once when no mutation is recorded" */
  it("starts the columns' mutation once and waits on it", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    const { saved, run } = metadataHarness(mutations);

    const result = await run({
      onPoll: async (progress) => {
        saved.push(progress);
        mutations.recordAnalyticsMetadataColumns({
          ...running,
          mutationId: "mutation_memory_1.txt",
          isDone: true,
        });
      },
    });

    expect(mutations.issuedAnalyticsMetadataColumns()).toBe(1);
    expect(mutations.issued()).toBe(0);
    expect(saved).toEqual([
      { mutationId: null, partsToDo: 0 },
      { mutationId: "mutation_memory_1.txt", partsToDo: 1 },
    ]);
    expect(result.mutationId).toBe("mutation_memory_1.txt");
  });

  /** @scenario "The step saves its checkpoint before it starts the mutation" */
  it("saves a checkpoint before the start", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    const { saved, run } = metadataHarness(mutations);
    let startedAtSave = -1;

    await run({
      onPoll: async (progress) => {
        saved.push(progress);
        if (saved.length === 1) startedAtSave = mutations.issuedAnalyticsMetadataColumns();
        else mutations.recordAnalyticsMetadataColumns({ ...running, isDone: true });
      },
    });

    expect(startedAtSave).toBe(0);
    expect(mutations.issuedAnalyticsMetadataColumns()).toBe(1);
    expect(materialisationProgressSchema.validate(saved[0])).toBe(true);
  });

  /** @scenario "The step starts no mutation when the parts already store the metadata columns" */
  it("finishes without a mutation when every part already stores the columns", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.holdPartsMissingAnalyticsMetadataColumns(0);
    const { saved, run } = metadataHarness(mutations);

    await expect(run()).resolves.toEqual({ mutationId: null, partsToDo: 0 });
    expect(mutations.issuedAnalyticsMetadataColumns()).toBe(0);
    expect(saved).toEqual([]);
  });

  /** @scenario "The step waits for the columns when its started mutation is not listed yet" */
  it("keeps polling after the start until every part stores the columns", async () => {
    const table = new UnlistedColumnsTable();
    const service = TraceIndexMaterialisationService.create({
      mutations: table,
      pollIntervalMs: 0,
    });

    const result = await service.waitForAnalyticsMetadataColumns({
      dryRun: false,
      resumed: false,
      signal: new AbortController().signal,
      onPoll: async () => undefined,
    });

    // Check 1 starts the mutation; check 2 still finds a part missing, so the step is not done.
    expect(table.started).toBe(1);
    expect(table.checks).toBe(3);
    expect(result).toEqual({ mutationId: null, partsToDo: 0 });
  });

  const resume = (table: IndexlessTable) =>
    TraceIndexMaterialisationService.create({
      mutations: table,
      pollIntervalMs: 0,
    }).waitForAnalyticsMetadataColumns({
      dryRun: false,
      resumed: true,
      signal: new AbortController().signal,
      onPoll: async () => undefined,
    });

  /** @scenario "A resumed step waits for the columns without starting a second mutation" */
  it("a resumed run with no mutation listed and the parts not yet filled never starts a second materialisation", async () => {
    const table = new UnlistedColumnsTable();
    table.checks = 1; // the parts are filled by the second check, inside the one grace poll

    await expect(resume(table)).resolves.toEqual({ mutationId: null, partsToDo: 0 });

    expect(table.started).toBe(0);
    expect(table.checks).toBe(3);
  });

  /** @scenario "A resumed step fails for an operator when no mutation is listed and the parts stay unfilled" */
  it("a resumed run fails after one grace poll when no mutation is listed and the parts stay unfilled", async () => {
    const table = new IndexlessTable();

    await expect(resume(table)).rejects.toThrow(
      /no mutation building the trace_analytics metadata columns.*killed or pruned.*system\.mutations/,
    );

    expect(table.started).toBe(0);
  });

  /** @scenario "A failed metadata-column mutation fails the step naming the columns" */
  it("throws the mutation's failure reason, naming the metadata columns", async () => {
    const mutations = MemoryTraceIndexMaterialisationRepository.create();
    mutations.recordAnalyticsMetadataColumns({ ...running, latestFailReason: "Memory limit" });
    const { saved, run } = metadataHarness(mutations);

    await expect(run()).rejects.toThrow(
      /trace_analytics metadata columns \(mutation mutation_7\.txt.*Memory limit/,
    );
    expect(saved).toEqual([]);
  });
});
