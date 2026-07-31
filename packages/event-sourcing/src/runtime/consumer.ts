import { noopMetrics } from "../ports/metrics";
import type {
  BlobSpool,
  BuiltPipeline,
  ClaimRequest,
  ConsumerBudget,
  Job,
  Lane,
  LaneConsumer,
  LaneQueue,
  Metrics,
  Registry,
  WireEvent,
} from "./contracts";

/**
 * Everything one lane-kind executor needs. Resolving `pipeline`/`name` down to
 * the concrete `BuiltFold` etc. and wiring stores, the outbox and process
 * state is the executor's own job — the consumer only ever calls it once per
 * claimed batch (ADR-108 decision 8).
 */
export interface LaneExecution {
  readonly pipeline: BuiltPipeline;
  readonly name: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly events: readonly WireEvent[];
}

export interface LaneExecutors {
  fold(execution: LaneExecution): Promise<void>;
  map(execution: LaneExecution): Promise<void>;
  subscriber(execution: LaneExecution): Promise<void>;
  processManager(execution: LaneExecution): Promise<void>;
}

export interface ConsumerDeps {
  readonly queue: LaneQueue;
  readonly spool: BlobSpool;
  readonly registry: Registry;
  readonly executors: LaneExecutors;
  readonly budget: ConsumerBudget;
  readonly metrics?: Metrics;
  /** One predicate, consulted before a claimed batch is executed (ADR-108
   * decision 13). Absent means every lane is enabled. */
  readonly enabled?: (lane: Lane) => boolean;
}

const POLL_INTERVAL_MS = 25;

function backoffMs(consecutiveFailures: number): number {
  return Math.min(30_000, 500 * 2 ** Math.max(0, consecutiveFailures - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execute(
  executors: LaneExecutors,
  lane: Lane,
  execution: LaneExecution,
): Promise<void> {
  switch (lane.kind) {
    case "fold":
      return executors.fold(execution);
    case "map":
      return executors.map(execution);
    case "subscriber":
      return executors.subscriber(execution);
    case "processManager":
      return executors.processManager(execution);
    default:
      throw new Error(`lane kind "${lane.kind}" has no executor`);
  }
}

function resolveMember(
  registry: Registry,
  lane: Lane,
  eventType: string,
): { readonly pipeline: BuiltPipeline; readonly name: string } | null {
  const candidates =
    lane.kind === "fold"
      ? registry.foldsFor(eventType)
      : lane.kind === "map"
        ? registry.mapsFor(eventType)
        : lane.kind === "subscriber"
          ? registry.subscribersFor(eventType)
          : lane.kind === "processManager"
            ? registry.processManagersFor(eventType)
            : [];
  return candidates.find((candidate) => candidate.name === lane.name) ?? null;
}

type DecodedJob = {
  readonly event: WireEvent;
  readonly blobRefToRelease?: string;
};

type DecodeOutcome =
  | { readonly kind: "ok"; readonly job: DecodedJob }
  | { readonly kind: "drop"; readonly reason: "missing-blob" | "malformed" }
  | { readonly kind: "transient" };

/**
 * Resolves and parses one job's payload. A missing blob and a malformed body
 * are both durable — retrying either wastes the same budget on a fault that
 * will not clear. Only the spool itself being unreachable is transient
 * (ADR-108: an undecodable job is not a transient fault).
 */
async function decodeOne(job: Job, spool: BlobSpool): Promise<DecodeOutcome> {
  let content: string;
  if (job.header.blobRef !== undefined) {
    let resolved: string | null;
    try {
      resolved = await spool.get(job.header.blobRef);
    } catch {
      return { kind: "transient" };
    }
    if (resolved === null) {
      await spool.release(job.header.blobRef);
      return { kind: "drop", reason: "missing-blob" };
    }
    content = resolved;
  } else {
    content = job.body;
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { kind: "drop", reason: "malformed" };
  }

  return {
    kind: "ok",
    job: {
      event: { type: job.header.eventType, data },
      blobRefToRelease: job.header.blobRef,
    },
  };
}

interface FailureState {
  executorFailures: number;
  transientFailures: number;
}

/**
 * Runs one claim-decode-execute-settle cycle. Exported directly so tests can
 * drive it without real timers; `createLaneConsumer` is the production loop
 * around it.
 */
export async function runOnce(
  deps: ConsumerDeps,
  failures: Map<string, FailureState>,
): Promise<"claimed" | "empty"> {
  const metrics = deps.metrics ?? noopMetrics;
  const dropped = metrics.counter({
    name: "es_dispatch_jobs_dropped_total",
    help: "Jobs the consumer recorded and settled without retrying.",
    labelNames: ["laneKind", "laneName", "reason"],
  });
  const settled = metrics.counter({
    name: "es_dispatch_batches_settled_total",
    help: "Batches settled after successful execution.",
    labelNames: ["laneKind", "laneName"],
  });

  const request: ClaimRequest = {
    maxJobs: deps.budget.maxJobs,
    maxBytes: deps.budget.maxBytes,
    leaseMs: deps.budget.leaseMs,
  };
  const batch = await deps.queue.claim(request);
  if (batch === null) return "empty";

  const { lane, lease } = batch;
  // A command lane may omit its name on purpose (every command type for one
  // aggregate then shares a lane), and a metric label has to be a string.
  const labels = { laneKind: lane.kind, laneName: lane.name ?? "" };

  if (deps.enabled !== undefined && !deps.enabled(lane)) {
    await deps.queue.retry(lease, 0);
    return "claimed";
  }

  const failureState = (): FailureState => {
    const existing = failures.get(lease.groupKey);
    if (existing) return existing;
    const created: FailureState = { executorFailures: 0, transientFailures: 0 };
    failures.set(lease.groupKey, created);
    return created;
  };

  const outcomes = await Promise.all(
    batch.jobs.map((job) => decodeOne(job, deps.spool)),
  );

  if (outcomes.some((outcome) => outcome.kind === "transient")) {
    const state = failureState();
    state.transientFailures += 1;
    if (
      deps.budget.parkAfterFailures > 0 &&
      state.transientFailures >= deps.budget.parkAfterFailures
    ) {
      dropped.inc({ ...labels, reason: "transient-exhausted" });
      failures.delete(lease.groupKey);
      await deps.queue.settle(lease);
    } else {
      await deps.queue.retry(lease, backoffMs(state.transientFailures));
    }
    return "claimed";
  }

  const survivors: DecodedJob[] = [];
  for (const outcome of outcomes) {
    // Narrow positively on "ok": the transient case returned above, but that
    // check was over the array, so it tells the checker nothing about an
    // element here.
    if (outcome.kind !== "ok") {
      if (outcome.kind === "drop")
        dropped.inc({ ...labels, reason: outcome.reason });
      continue;
    }
    survivors.push(outcome.job);
  }

  const [firstSurvivor] = survivors;
  if (firstSurvivor === undefined) {
    await deps.queue.settle(lease);
    return "claimed";
  }

  const [firstJob] = batch.jobs;
  const member = resolveMember(deps.registry, lane, firstSurvivor.event.type);

  try {
    if (member === null)
      throw new Error(`no "${lane.kind}" named "${lane.name}" is registered`);
    if (firstJob === undefined) throw new Error("a claimed batch had no jobs");
    const execution: LaneExecution = {
      pipeline: member.pipeline,
      // The resolved member always has one, where an unnamed command lane does not.
      name: member.name,
      tenantId: batch.tenantId,
      aggregateId: firstJob.header.aggregateId,
      events: survivors.map((survivor) => survivor.event),
    };
    await execute(deps.executors, lane, execution);
  } catch (error) {
    if (lane.kind === "subscriber") {
      dropped.inc({ ...labels, reason: "subscriber-failed" });
      await deps.queue.settle(lease);
      return "claimed";
    }

    const state = failureState();
    state.executorFailures += 1;
    if (
      deps.budget.parkAfterFailures > 0 &&
      state.executorFailures >= deps.budget.parkAfterFailures
    ) {
      const reason = error instanceof Error ? error.message : String(error);
      await deps.queue.park(
        lease,
        `parked after ${state.executorFailures} consecutive failures: ${reason}`,
      );
      failures.delete(lease.groupKey);
    } else {
      await deps.queue.retry(lease, backoffMs(state.executorFailures));
    }
    return "claimed";
  }

  failures.delete(lease.groupKey);
  for (const survivor of survivors) {
    if (survivor.blobRefToRelease !== undefined)
      await deps.spool.release(survivor.blobRefToRelease);
  }
  settled.inc(labels);
  await deps.queue.settle(lease);
  return "claimed";
}

export function createLaneConsumer(deps: ConsumerDeps): LaneConsumer {
  const failures = new Map<string, FailureState>();
  let running = false;
  const workers: Promise<void>[] = [];

  async function loop(): Promise<void> {
    while (running) {
      const outcome = await runOnce(deps, failures);
      if (outcome === "empty") await sleep(POLL_INTERVAL_MS);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      const concurrency = Math.max(1, deps.budget.maxInFlight);
      for (let i = 0; i < concurrency; i++) workers.push(loop());
    },
    async stop() {
      running = false;
      await Promise.all(workers.splice(0));
    },
  };
}
