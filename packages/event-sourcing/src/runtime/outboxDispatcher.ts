import type {
  BuiltProcessManager,
  BuiltProcessManagerIntent,
} from "../pipeline/pipeline.types";
import { intentTypeOf } from "../pipeline/typeStrings";
import type { Metrics } from "../ports/metrics";
import { noopMetrics } from "../ports/metrics";
import type { Clock, HandlerContext, Outbox, OutboxRow } from "./contracts";
import { toDispatchError } from "./dispatchError";

/**
 * The outbox dispatcher (ADR-108 decision 11): claim a lease, deliver, settle
 * or fail. An intent's `deliver` must throw a classified `DispatchError` to
 * be seen as failed — a delivery that logs and returns is indistinguishable
 * from success, which is the failure mode this exists to prevent.
 */

type DispatchOutcome = "settled" | "retried" | "dead";

export interface OutboxDispatcherDeps {
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly processManagers: readonly BuiltProcessManager[];
  readonly metrics?: Metrics;
  /** Backoff in ms for a retryable failure, given the row's attempt count
   * before this failure. Defaults to a capped exponential backoff. */
  readonly backoffMs?: (attempt: number) => number;
}

export interface OutboxDispatcher {
  dispatchOnce(args: {
    readonly limit: number;
    readonly leaseMs: number;
  }): Promise<{
    readonly settled: number;
    readonly retried: number;
    readonly dead: number;
  }>;
  prune(processName: string, before: number): Promise<number>;
}

function defaultBackoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

function buildIntentIndex(
  managers: readonly BuiltProcessManager[],
): Map<string, BuiltProcessManagerIntent> {
  const index = new Map<string, BuiltProcessManagerIntent>();
  for (const manager of managers) {
    for (const key of Object.keys(manager.intents)) {
      index.set(intentTypeOf(manager.name, key), manager.intents[key]!);
    }
  }
  return index;
}

export function createOutboxDispatcher(
  deps: OutboxDispatcherDeps,
): OutboxDispatcher {
  const metrics = deps.metrics ?? noopMetrics;
  const outcomes = metrics.counter({
    name: "es_outbox_dispatch_outcomes_total",
    help: "Outbox row dispatch outcomes, by intent type and outcome.",
    labelNames: ["intentType", "outcome"],
  });
  const backoffFor = deps.backoffMs ?? defaultBackoffMs;
  const intentIndex = buildIntentIndex(deps.processManagers);

  async function dispatchRow(row: OutboxRow): Promise<DispatchOutcome> {
    const target = intentIndex.get(row.intentType);
    if (!target) {
      // Nothing declares this intent type any more — retrying can never
      // resolve it, so it is dead rather than retried forever.
      await deps.outbox.fail(row.id, false, 0);
      return "dead";
    }

    const ctx: HandlerContext = {
      now: deps.clock.now(),
      tenantId: row.tenantId,
    };
    try {
      await target.deliver(JSON.parse(row.payload), ctx);
    } catch (error) {
      // Follows dispatch-error-contract.feature: a DispatchError's own
      // classification is authoritative; anything else defaults retryable.
      const { retryable } = toDispatchError(error, {
        message: "intent delivery failed",
      });
      await deps.outbox.fail(
        row.id,
        retryable,
        retryable ? backoffFor(row.attempt) : 0,
      );
      return retryable ? "retried" : "dead";
    }

    await deps.outbox.settle(row.id);
    return "settled";
  }

  return {
    async dispatchOnce({ limit, leaseMs }) {
      const rows = await deps.outbox.claim(limit, leaseMs);
      let settled = 0;
      let retried = 0;
      let dead = 0;
      for (const row of rows) {
        const outcome = await dispatchRow(row);
        outcomes.inc({ intentType: row.intentType, outcome });
        if (outcome === "settled") settled += 1;
        else if (outcome === "retried") retried += 1;
        else dead += 1;
      }
      return { settled, retried, dead };
    },

    prune(processName, before) {
      return deps.outbox.prune(processName, before);
    },
  };
}
