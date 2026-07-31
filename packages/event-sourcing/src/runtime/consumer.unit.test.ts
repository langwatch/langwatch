import { describe, expect, it } from "vitest";
import type { MetricLabels, Metrics } from "../ports/metrics";
import {
  createLaneConsumer,
  type LaneExecution,
  type LaneExecutors,
  runOnce,
} from "./consumer";
import type {
  BlobSpool,
  BuiltPipeline,
  ClaimedBatch,
  ConsumerBudget,
  GroupKey,
  Job,
  Lane,
  LaneQueue,
  Lease,
  Registry,
  StagedJob,
} from "./contracts";
import { memoryClock, memoryQueue, memorySpool } from "./memory";

/**
 * The consumer's job is claim -> decode -> execute -> settle/retry/park
 * (ADR-108 decisions 4, 8). Most scenarios drive it against `memoryQueue` —
 * the same in-memory `LaneQueue` the rest of the runtime package uses — so
 * staging, sequencing and byte-bounded claiming are exercised for real. A
 * few decode-classification scenarios need a hand-built batch instead,
 * because staging through the port has no way to attach a blob reference.
 */

const stubPipeline = {} as BuiltPipeline;

function fold(name: string): Lane {
  return { kind: "fold", name };
}

function descriptor(
  overrides: Partial<GroupKey> & { aggregateId?: string } = {},
): GroupKey {
  return {
    tenantId: "tenant-1",
    lane: fold("traceSummary"),
    scope: {
      kind: "aggregate",
      aggregateType: "trace",
      aggregateId: overrides.aggregateId ?? "trace-1",
    },
    ...overrides,
  };
}

let orderingKey = 0;
function stagedJob(overrides: Partial<StagedJob> = {}): StagedJob {
  orderingKey += 1;
  return {
    descriptor: descriptor(),
    orderingKey,
    aggregateId: "trace-1",
    eventType: "trace/spanReceived",
    eventId: `evt-${orderingKey}`,
    costBytes: 10,
    body: '{"ok":true}',
    ...overrides,
  };
}

function fakeRegistry(
  entries: readonly { kind: Lane["kind"]; name: string; eventType: string }[],
): Registry {
  const lookup = (kind: Lane["kind"], eventType: string) =>
    entries
      .filter((entry) => entry.kind === kind && entry.eventType === eventType)
      .map((entry) => ({ pipeline: stubPipeline, name: entry.name }));
  return {
    register: () => undefined,
    all: () => [],
    commandNames: () => [],
    findCommand: () => null,
    subscribersFor: (eventType) => lookup("subscriber", eventType),
    foldsFor: (eventType) => lookup("fold", eventType),
    mapsFor: (eventType) => lookup("map", eventType),
    processManagersFor: (eventType) => lookup("processManager", eventType),
    assertResolvable: () => undefined,
  };
}

type ExecutorBehavior = (execution: LaneExecution) => void | Promise<void>;

function fakeExecutors(
  behavior: Partial<Record<keyof LaneExecutors, ExecutorBehavior>> = {},
): LaneExecutors & {
  readonly calls: {
    readonly kind: keyof LaneExecutors;
    readonly execution: LaneExecution;
  }[];
} {
  const calls: { kind: keyof LaneExecutors; execution: LaneExecution }[] = [];
  const wrap =
    (kind: keyof LaneExecutors) =>
    async (execution: LaneExecution): Promise<void> => {
      calls.push({ kind, execution });
      await behavior[kind]?.(execution);
    };
  return {
    calls,
    fold: wrap("fold"),
    map: wrap("map"),
    subscriber: wrap("subscriber"),
    processManager: wrap("processManager"),
  };
}

/** Records every counter increment so a test can assert what the consumer
 * recorded, the same pattern `definePipeline.unit.test.ts` uses. */
function fakeMetrics(): Metrics & {
  readonly incs: { name: string; labels: MetricLabels | undefined }[];
} {
  const incs: { name: string; labels: MetricLabels | undefined }[] = [];
  return {
    incs,
    counter: (spec) => ({
      inc: (labels) => incs.push({ name: spec.name, labels }),
    }),
    histogram: () => ({ observe: () => undefined }),
  };
}

const budget: ConsumerBudget = {
  maxJobs: 100,
  maxBytes: 4 * 1024 * 1024,
  maxInFlight: 4,
  leaseMs: 30_000,
  parkAfterFailures: 3,
  tenantSoftCap: 50,
};

const foldRegistry = fakeRegistry([
  { kind: "fold", name: "traceSummary", eventType: "trace/spanReceived" },
]);

describe("runOnce", () => {
  describe("given an operator's enabled predicate", () => {
    /** @scenario A lane claimed just as it becomes disabled is put back unexecuted */
    it("puts a claimed batch back without deciding or executing when the lane is disabled", async () => {
      const queue = singleBatchQueue(claimedBatch([claimedJob()]));
      const executors = fakeExecutors();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget,
        enabled: () => false,
      };

      await runOnce(deps, new Map());
      expect(executors.calls).toEqual([]);
      expect(queue.calls.retried).toEqual([
        { lease: claimedBatch([]).lease, afterMs: 0 },
      ]);
      expect(queue.calls.settled).toEqual([]);
      expect(queue.calls.parked).toEqual([]);
    });
  });

  describe("given a claim bounded by count and bytes", () => {
    /** @scenario A claim stops adding jobs once the byte bound would be exceeded */
    it("stops adding jobs to a batch once the byte bound would be exceeded", async () => {
      const clock = memoryClock();
      const queue = memoryQueue(clock);
      await queue.stage([
        stagedJob({ eventId: "e1", costBytes: 1_500_000 }),
        stagedJob({ eventId: "e2", costBytes: 1_500_000 }),
        stagedJob({ eventId: "e3", costBytes: 1_500_000 }),
      ]);
      const executors = fakeExecutors();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget: { ...budget, maxBytes: 4_000_000 },
      };

      await runOnce(deps, new Map());
      expect(executors.calls[0]?.execution.events).toHaveLength(2);

      clock.advance(1);
      await runOnce(deps, new Map());
      expect(executors.calls[1]?.execution.events).toHaveLength(1);
    });

    /** @scenario A single job larger than the byte bound is still claimed alone */
    it("claims an oversized single job alone rather than never claiming it", async () => {
      const queue = memoryQueue(memoryClock());
      await queue.stage([stagedJob({ eventId: "big", costBytes: 10_000_000 })]);
      const executors = fakeExecutors();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget: { ...budget, maxBytes: 4_000_000 },
      };

      await runOnce(deps, new Map());
      expect(executors.calls).toHaveLength(1);
      expect(executors.calls[0]?.execution.events).toHaveLength(1);
    });
  });

  describe("given execution differs by lane kind", () => {
    /** @scenario A fold's batch is applied as one left-fold over its events */
    it("applies a fold's whole batch in one call, in the batch's order", async () => {
      const queue = memoryQueue(memoryClock());
      await queue.stage([
        stagedJob({ eventId: "e1" }),
        stagedJob({ eventId: "e2" }),
        stagedJob({ eventId: "e3" }),
      ]);
      const executors = fakeExecutors();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget,
      };

      await runOnce(deps, new Map());
      expect(executors.calls).toHaveLength(1);
      expect(executors.calls[0]?.kind).toBe("fold");
      expect(executors.calls[0]?.execution.events.map((e) => e.type)).toEqual([
        "trace/spanReceived",
        "trace/spanReceived",
        "trace/spanReceived",
      ]);
    });

    /** @scenario A map's batch is written as one bulk write */
    it("writes a map's whole batch in one call rather than one write per event", async () => {
      const queue = memoryQueue(memoryClock());
      const mapDescriptor = descriptor({
        lane: { kind: "map", name: "spanStorage" },
      });
      await queue.stage([
        stagedJob({ descriptor: mapDescriptor, eventId: "e1" }),
        stagedJob({ descriptor: mapDescriptor, eventId: "e2" }),
      ]);
      const registry = fakeRegistry([
        { kind: "map", name: "spanStorage", eventType: "trace/spanReceived" },
      ]);
      const executors = fakeExecutors();
      const deps = { queue, spool: memorySpool(), registry, executors, budget };

      await runOnce(deps, new Map());
      expect(executors.calls).toHaveLength(1);
      expect(executors.calls[0]?.kind).toBe("map");
      expect(executors.calls[0]?.execution.events).toHaveLength(2);
    });

    /** @scenario A subscriber's failure is logged and settled, never retried */
    it("settles a failing subscriber's batch instead of retrying or parking it", async () => {
      const queue = memoryQueue(memoryClock());
      const subDescriptor = descriptor({
        lane: { kind: "subscriber", name: "projectMetadata" },
      });
      await queue.stage([stagedJob({ descriptor: subDescriptor })]);
      const registry = fakeRegistry([
        {
          kind: "subscriber",
          name: "projectMetadata",
          eventType: "trace/spanReceived",
        },
      ]);
      const executors = fakeExecutors({
        subscriber: () => {
          throw new Error("subscriber blew up");
        },
      });
      const metrics = fakeMetrics();
      const deps = {
        queue,
        spool: memorySpool(),
        registry,
        executors,
        budget,
        metrics,
      };

      await runOnce(deps, new Map());
      expect(queue.totalDepth()).toBe(0);
      expect(queue.parkedLanes()).toEqual([]);
      expect(
        metrics.incs.some((inc) => inc.labels?.reason === "subscriber-failed"),
      ).toBe(true);
    });

    /** @scenario A process manager's batch produces one emission, not one per event */
    it("calls the process manager executor once for a batch of several events", async () => {
      const queue = memoryQueue(memoryClock());
      const pmDescriptor = descriptor({
        lane: { kind: "processManager", name: "digestPm" },
      });
      await queue.stage([
        stagedJob({ descriptor: pmDescriptor, eventId: "e1" }),
        stagedJob({ descriptor: pmDescriptor, eventId: "e2" }),
        stagedJob({ descriptor: pmDescriptor, eventId: "e3" }),
      ]);
      const registry = fakeRegistry([
        {
          kind: "processManager",
          name: "digestPm",
          eventType: "trace/spanReceived",
        },
      ]);
      const executors = fakeExecutors();
      const deps = { queue, spool: memorySpool(), registry, executors, budget };

      await runOnce(deps, new Map());
      const pmCalls = executors.calls.filter(
        (call) => call.kind === "processManager",
      );
      expect(pmCalls).toHaveLength(1);
      expect(pmCalls[0]?.execution.events).toHaveLength(3);
    });
  });

  describe("given a lane's consecutive failures", () => {
    /** @scenario A lane parks once its consecutive-failure budget is spent */
    it("parks a lane once it fails as many times in a row as its budget allows", async () => {
      const clock = memoryClock();
      const queue = memoryQueue(clock);
      const failures = new Map();
      const executors = fakeExecutors({
        fold: () => {
          throw new Error("boom");
        },
      });
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget: { ...budget, parkAfterFailures: 3 },
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        await queue.stage([stagedJob({ eventId: `e${attempt}` })]);
        await runOnce(deps, failures);
        clock.advance(60_000);
      }

      const parked = queue.parkedLanes();
      expect(parked).toHaveLength(1);
      expect(parked[0]?.reason).toContain("3 consecutive failures");
    });

    /** @scenario A success clears a lane's consecutive-failure count */
    it("resets the consecutive-failure count after a success, so it does not compound", async () => {
      const clock = memoryClock();
      const queue = memoryQueue(clock);
      const failures = new Map();
      let callNumber = 0;
      const executors = fakeExecutors({
        fold: () => {
          callNumber += 1;
          // Fails twice, succeeds once, then fails twice more — never three
          // in a row, so it should never park under a budget of 3.
          if (callNumber === 3) return;
          throw new Error("transient hiccup");
        },
      });
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget: { ...budget, parkAfterFailures: 3 },
      };

      for (let attempt = 0; attempt < 5; attempt++) {
        await queue.stage([stagedJob({ eventId: `e${attempt}` })]);
        await runOnce(deps, failures);
        clock.advance(60_000);
      }

      expect(queue.parkedLanes()).toEqual([]);
    });

    /** @scenario A parking budget of zero disables parking for that lane */
    it("never parks when the parking budget is configured as zero", async () => {
      const clock = memoryClock();
      const queue = memoryQueue(clock);
      const failures = new Map();
      const executors = fakeExecutors({
        fold: () => {
          throw new Error("always fails");
        },
      });
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget: { ...budget, parkAfterFailures: 0 },
      };

      for (let attempt = 0; attempt < 10; attempt++) {
        await queue.stage([stagedJob({ eventId: `e${attempt}` })]);
        await runOnce(deps, failures);
        clock.advance(60_000);
      }

      expect(queue.parkedLanes()).toEqual([]);
    });
  });

  describe("given a job whose body cannot be decoded", () => {
    /** @scenario An undecodable job is recorded and settled, not retried */
    it("records and settles an undecodable job instead of retrying it", async () => {
      const queue = memoryQueue(memoryClock());
      await queue.stage([stagedJob({ body: "not valid json" })]);
      const executors = fakeExecutors();
      const metrics = fakeMetrics();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget,
        metrics,
      };

      await runOnce(deps, new Map());
      expect(executors.calls).toEqual([]);
      expect(queue.totalDepth()).toBe(0);
      expect(
        metrics.incs.some((inc) => inc.labels?.reason === "malformed"),
      ).toBe(true);
    });

    /** @scenario An undecodable sibling does not hold back the rest of its batch */
    it("executes the decodable jobs in a batch and drops only the undecodable one", async () => {
      const queue = memoryQueue(memoryClock());
      await queue.stage([
        stagedJob({ eventId: "good" }),
        stagedJob({ eventId: "bad", body: "not valid json" }),
      ]);
      const executors = fakeExecutors();
      const metrics = fakeMetrics();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget,
        metrics,
      };

      await runOnce(deps, new Map());
      expect(executors.calls).toHaveLength(1);
      expect(executors.calls[0]?.execution.events).toHaveLength(1);
      expect(
        metrics.incs.some((inc) => inc.labels?.reason === "malformed"),
      ).toBe(true);
      expect(queue.totalDepth()).toBe(0);
    });

    /** @scenario A batch that is entirely undecodable settles as empty rather than parking */
    it("settles a batch whose every job is undecodable without parking the lane", async () => {
      const queue = memoryQueue(memoryClock());
      await queue.stage([
        stagedJob({ eventId: "bad1", body: "not valid json" }),
        stagedJob({ eventId: "bad2", body: "also not valid" }),
      ]);
      const executors = fakeExecutors();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget,
      };

      await runOnce(deps, new Map());
      expect(executors.calls).toEqual([]);
      expect(queue.parkedLanes()).toEqual([]);
      expect(queue.totalDepth()).toBe(0);
    });

    /** @scenario A drop leaves the lane live for its next job */
    it("processes the next job staged after a drop normally", async () => {
      const queue = memoryQueue(memoryClock());
      await queue.stage([
        stagedJob({ eventId: "bad", body: "not valid json" }),
      ]);
      const executors = fakeExecutors();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget,
      };
      await runOnce(deps, new Map());
      expect(executors.calls).toEqual([]);

      await queue.stage([stagedJob({ eventId: "good" })]);
      await runOnce(deps, new Map());
      expect(executors.calls).toHaveLength(1);
    });
  });

  describe("given a job dropped as not counted as completed", () => {
    /** @scenario Dropping a job does not increment the count of completed work */
    it("does not record a settled-batch metric when the batch is only a drop", async () => {
      const queue = memoryQueue(memoryClock());
      await queue.stage([stagedJob({ body: "not valid json" })]);
      const executors = fakeExecutors();
      const metrics = fakeMetrics();
      const deps = {
        queue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors,
        budget,
        metrics,
      };

      await runOnce(deps, new Map());
      expect(metrics.incs.some((inc) => inc.name.includes("settled"))).toBe(
        false,
      );
    });
  });
});

/** Builds a single-shot `LaneQueue` serving one hand-constructed batch, for
 * decode-classification scenarios a `blobRef` needs that `StagedJob` (the
 * port's staging shape) has no field to carry. */
function singleBatchQueue(batch: ClaimedBatch): LaneQueue & {
  readonly calls: {
    settled: Lease[];
    retried: { lease: Lease; afterMs: number }[];
    parked: { lease: Lease; reason: string }[];
  };
} {
  let served = false;
  const calls = {
    settled: [] as Lease[],
    retried: [] as { lease: Lease; afterMs: number }[],
    parked: [] as { lease: Lease; reason: string }[],
  };
  return {
    calls,
    stage: async () => undefined,
    claim: async () => {
      if (served) return null;
      served = true;
      return batch;
    },
    settle: async (lease) => {
      calls.settled.push(lease);
    },
    retry: async (lease, afterMs) => {
      calls.retried.push({ lease, afterMs });
    },
    park: async (lease, reason) => {
      calls.parked.push({ lease, reason });
    },
    depth: async () => 0,
  };
}

function claimedJob(
  overrides: Partial<Job["header"]> = {},
  body = '{"ok":true}',
): Job {
  return {
    header: {
      tenantId: "tenant-1",
      lane: fold("traceSummary"),
      scopeParts: [],
      aggregateId: "trace-1",
      eventType: "trace/spanReceived",
      eventId: "evt-1",
      sequence: 1,
      attempt: 0,
      costBytes: 10,
      ...overrides,
    },
    body,
  };
}

function claimedBatch(jobs: Job[]): ClaimedBatch {
  return {
    lease: {
      groupKey: "tenant-1/fold/traceSummary/agg/trace/trace-1",
      token: "lease-1",
    },
    lane: fold("traceSummary"),
    tenantId: "tenant-1",
    jobs,
  };
}

function trackingSpool(
  inner: BlobSpool,
): BlobSpool & { readonly released: string[] } {
  const released: string[] = [];
  return {
    put: (tenantId, body) => inner.put(tenantId, body),
    get: (ref) => inner.get(ref),
    release: async (ref) => {
      released.push(ref);
      await inner.release(ref);
    },
    released,
  };
}

function rejectingSpool(message: string): BlobSpool {
  return {
    put: () => Promise.reject(new Error("not used")),
    get: () => Promise.reject(new Error(message)),
    release: () => Promise.resolve(),
  };
}

describe("runOnce given a blob-referencing job", () => {
  /** @scenario A job whose blob reference resolves to nothing is classified as missing */
  it("classifies a blob reference the spool no longer holds as missing, and releases its holder", async () => {
    const spool = trackingSpool(memorySpool());
    const queue = singleBatchQueue(
      claimedBatch([claimedJob({ blobRef: "tenant-1/blob-gone" })]),
    );
    const metrics = fakeMetrics();
    const deps = {
      queue,
      spool,
      registry: foldRegistry,
      executors: fakeExecutors(),
      budget,
      metrics,
    };

    await runOnce(deps, new Map());
    expect(
      metrics.incs.some((inc) => inc.labels?.reason === "missing-blob"),
    ).toBe(true);
    expect(spool.released).toContain("tenant-1/blob-gone");
    expect(queue.calls.settled).toHaveLength(1);
  });

  /** @scenario A job whose resolved body is not valid is classified as malformed, and its blob is kept */
  it("classifies a resolved-but-unparseable body as malformed, and keeps its blob", async () => {
    const backing = memorySpool();
    const ref = await backing.put("tenant-1", "not valid json");
    const spool = trackingSpool(backing);
    const queue = singleBatchQueue(
      claimedBatch([claimedJob({ blobRef: ref })]),
    );
    const metrics = fakeMetrics();
    const deps = {
      queue,
      spool,
      registry: foldRegistry,
      executors: fakeExecutors(),
      budget,
      metrics,
    };

    await runOnce(deps, new Map());
    expect(metrics.incs.some((inc) => inc.labels?.reason === "malformed")).toBe(
      true,
    );
    expect(spool.released).toEqual([]);
    expect(await backing.get(ref)).not.toBeNull();
  });

  /** @scenario Classification does not depend on matching the underlying exception's message */
  it("tells a missing blob apart from a malformed body without matching exception text", async () => {
    const backing = memorySpool();
    const malformedRef = await backing.put("tenant-1", "{unterminated");
    const metrics = fakeMetrics();

    const missingQueue = singleBatchQueue(
      claimedBatch([claimedJob({ blobRef: "gone-ref" })]),
    );
    await runOnce(
      {
        queue: missingQueue,
        spool: memorySpool(),
        registry: foldRegistry,
        executors: fakeExecutors(),
        budget,
        metrics,
      },
      new Map(),
    );

    const malformedQueue = singleBatchQueue(
      claimedBatch([claimedJob({ blobRef: malformedRef })]),
    );
    await runOnce(
      {
        queue: malformedQueue,
        spool: backing,
        registry: foldRegistry,
        executors: fakeExecutors(),
        budget,
        metrics,
      },
      new Map(),
    );

    const reasons = metrics.incs.map((inc) => inc.labels?.reason);
    expect(reasons).toContain("missing-blob");
    expect(reasons).toContain("malformed");
  });

  /** @scenario A body that is temporarily unreachable retries instead of being dropped */
  it("retries instead of dropping when the spool rejects with a transient error", async () => {
    const queue = singleBatchQueue(
      claimedBatch([claimedJob({ blobRef: "tenant-1/blob-1" })]),
    );
    const metrics = fakeMetrics();
    const deps = {
      queue,
      spool: rejectingSpool("ECONNRESET"),
      registry: foldRegistry,
      executors: fakeExecutors(),
      budget,
      metrics,
    };

    await runOnce(deps, new Map());
    expect(queue.calls.retried).toHaveLength(1);
    expect(queue.calls.settled).toEqual([]);
    expect(
      metrics.incs.some((inc) => inc.labels?.reason === "transient-exhausted"),
    ).toBe(false);
  });

  /** @scenario A body that stays unreachable for the whole retry budget is a counted loss */
  it("counts a body that never becomes reachable as a transient-exhausted drop once the budget is spent", async () => {
    const failures = new Map();
    const metrics = fakeMetrics();
    let lastQueue: ReturnType<typeof singleBatchQueue> | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      lastQueue = singleBatchQueue(
        claimedBatch([claimedJob({ blobRef: "tenant-1/blob-1" })]),
      );
      await runOnce(
        {
          queue: lastQueue,
          spool: rejectingSpool("still down"),
          registry: foldRegistry,
          executors: fakeExecutors(),
          budget: { ...budget, parkAfterFailures: 3 },
          metrics,
        },
        failures,
      );
    }

    expect(lastQueue?.calls.settled).toHaveLength(1);
    expect(lastQueue?.calls.parked).toEqual([]);
    expect(
      metrics.incs.some((inc) => inc.labels?.reason === "transient-exhausted"),
    ).toBe(true);
  });
});

describe("createLaneConsumer", () => {
  /** @scenario A consumer does not exceed its configured in-flight budget */
  it("never holds more claimed batches at once than its configured in-flight budget", async () => {
    const clock = memoryClock();
    const inner = memoryQueue(clock);
    for (let i = 0; i < 6; i++) {
      await inner.stage([
        stagedJob({
          descriptor: descriptor({ aggregateId: `trace-${i}` }),
          eventId: `e${i}`,
        }),
      ]);
    }

    let outstanding = 0;
    let peak = 0;
    const tracked: LaneQueue = {
      stage: (jobs) => inner.stage(jobs),
      depth: (groupKey) => inner.depth(groupKey),
      async claim(request) {
        const claimed = await inner.claim(request);
        if (claimed === null) return null;
        outstanding += 1;
        peak = Math.max(peak, outstanding);
        // Held open briefly so concurrent workers genuinely overlap.
        await new Promise((resolve) => setTimeout(resolve, 15));
        return claimed;
      },
      async settle(lease) {
        outstanding -= 1;
        await inner.settle(lease);
      },
      async retry(lease, afterMs) {
        outstanding -= 1;
        await inner.retry(lease, afterMs);
      },
      async park(lease, reason) {
        outstanding -= 1;
        await inner.park(lease, reason);
      },
    };

    const consumer = createLaneConsumer({
      queue: tracked,
      spool: memorySpool(),
      registry: foldRegistry,
      executors: fakeExecutors(),
      budget: { ...budget, maxInFlight: 2 },
    });

    consumer.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await consumer.stop();

    expect(peak).toBeLessThanOrEqual(2);
    expect(inner.totalDepth()).toBe(0);
  });
});

describe("the lane queue's sequence assignment", () => {
  /** @scenario Two jobs staged into one lane get increasing sequences */
  it("assigns the second job staged into a lane a higher sequence than the first", async () => {
    const queue = memoryQueue(memoryClock());
    await queue.stage([stagedJob({ eventId: "e1" })]);
    await queue.stage([stagedJob({ eventId: "e2" })]);

    const first = await queue.claim({
      maxJobs: 10,
      maxBytes: 1_000_000,
      leaseMs: 1000,
    });
    expect(first?.jobs.map((job) => job.header.sequence)).toEqual([1, 2]);
  });

  /** @scenario Two lanes do not share a sequence space */
  it("numbers two different lanes independently", async () => {
    const queue = memoryQueue(memoryClock());
    await queue.stage([
      stagedJob({
        descriptor: descriptor({ aggregateId: "trace-a" }),
        eventId: "e1",
      }),
    ]);
    await queue.stage([
      stagedJob({
        descriptor: descriptor({ aggregateId: "trace-b" }),
        eventId: "e2",
      }),
    ]);

    const first = await queue.claim({
      maxJobs: 10,
      maxBytes: 1_000_000,
      leaseMs: 1000,
    });
    const second = await queue.claim({
      maxJobs: 10,
      maxBytes: 1_000_000,
      leaseMs: 1000,
    });
    const sequences = [first, second].map(
      (batch) => batch?.jobs[0]?.header.sequence,
    );
    expect(sequences.sort()).toEqual([1, 1]);
  });

  /** @scenario A job cannot be staged without a sequence */
  it("gives every staged job a sequence", async () => {
    const queue = memoryQueue(memoryClock());
    await queue.stage([stagedJob()]);
    const batch = await queue.claim({
      maxJobs: 10,
      maxBytes: 1_000_000,
      leaseMs: 1000,
    });
    expect(typeof batch?.jobs[0]?.header.sequence).toBe("number");
  });
});
