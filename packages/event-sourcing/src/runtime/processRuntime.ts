import { ConfigurationError, UndecodableStateError } from "../errors";
import type {
  BuiltProcessManager,
  BuiltProcessManagerIntent,
  ProcessContext,
  WireEvent,
} from "../pipeline/pipeline.types";
import { intentTypeOf } from "../pipeline/typeStrings";
import type { Metrics } from "../ports/metrics";
import { noopMetrics } from "../ports/metrics";
import { withSpan } from "../ports/tracing";
import type {
  Clock,
  Outbox,
  OutboxRow,
  ProcessInstanceKey,
  ProcessStore,
} from "./contracts";

/**
 * The process-manager runtime (ADR-108 decision 11): one pure step per
 * delivery — load state, evolve it against every handled event in the batch,
 * persist the result and stage whatever intents that evolution minted.
 */

export interface ProcessRuntimeDeps {
  readonly processStore: ProcessStore;
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly metrics?: Metrics;
}

export interface ProcessDeliveryArgs {
  readonly key: ProcessInstanceKey;
  readonly tenantId: string;
  readonly events: readonly WireEvent[];
}

export interface ProcessWakeArgs {
  readonly key: ProcessInstanceKey;
  readonly tenantId: string;
}

export interface ProcessArmArgs {
  readonly key: ProcessInstanceKey;
  readonly tenantId: string;
  readonly initialWakeAt: number;
}

export interface ProcessRuntime {
  deliver(
    manager: BuiltProcessManager,
    args: ProcessDeliveryArgs,
  ): Promise<{ readonly applied: number }>;
  wake(
    manager: BuiltProcessManager,
    args: ProcessWakeArgs,
  ): Promise<{ readonly ran: boolean }>;
  pollDue(
    managers: Readonly<Record<string, BuiltProcessManager>>,
    args: { readonly limit: number },
  ): Promise<{ readonly woken: number }>;
  ensureArmed(
    manager: BuiltProcessManager,
    args: ProcessArmArgs,
  ): Promise<{ readonly armed: boolean }>;
}

type LoadResult<State> =
  | { readonly kind: "found"; readonly state: State; readonly revision: number }
  | { readonly kind: "absent" };

/** A row present but undecodable is never genesis (ADR-107 decision 9) — it
 * fails loudly instead of overwriting whatever is there with a fresh
 * accumulator stamped current. */
async function loadState<State>(
  processStore: ProcessStore,
  manager: BuiltProcessManager<State>,
  key: ProcessInstanceKey,
): Promise<LoadResult<State>> {
  const stored = await processStore.load(key);
  if (stored === null) return { kind: "absent" };

  // An empty stamp is a row written before process managers carried a version
  // at all. It is accepted and re-stamped by the next save, because rejecting
  // it would fail every live instance at once on the deploy that adds the
  // column — the failure ADR-107 decision 11 exists to avoid. A derived version
  // is always 12 hex characters, so "" can never collide with a real one. The
  // shape is still validated below: an unstamped row whose state no longer
  // parses is genuinely undecodable.
  if (
    stored.stateVersion !== "" &&
    stored.stateVersion !== manager.stateVersion
  ) {
    throw new UndecodableStateError({
      projectionName: manager.name,
      aggregateId: key.processKey,
      storedVersion: stored.stateVersion,
      expectedVersion: manager.stateVersion,
    });
  }
  const parsed = manager.stateSchema.safeParse(stored.state);
  if (!parsed.success) {
    throw new UndecodableStateError({
      projectionName: manager.name,
      aggregateId: key.processKey,
      storedVersion: stored.stateVersion,
      expectedVersion: manager.stateVersion,
      cause: parsed.error,
    });
  }
  return { kind: "found", state: parsed.data, revision: stored.revision };
}

/** A backed-up consumer must never write a deadline in the past — that would
 * mark the process due again on the very next poll, forever. */
function clampWake(nextWakeAt: number | null, now: number): number | null {
  return nextWakeAt === null ? null : Math.max(nextWakeAt, now);
}

function intentIndex(
  manager: BuiltProcessManager,
): Map<string, BuiltProcessManagerIntent> {
  const index = new Map<string, BuiltProcessManagerIntent>();
  for (const key of Object.keys(manager.intents)) {
    index.set(intentTypeOf(manager.name, key), manager.intents[key]!);
  }
  return index;
}

function toOutboxRows(args: {
  readonly tenantId: string;
  readonly manager: BuiltProcessManager;
  readonly intents: readonly {
    readonly type: string;
    readonly payload: unknown;
  }[];
}): Omit<OutboxRow, "id" | "attempt">[] {
  const index = intentIndex(args.manager);
  return args.intents.map((intent) => {
    const def = index.get(intent.type);
    if (!def) {
      throw new ConfigurationError(
        `process manager "${args.manager.name}" evolved an intent nobody declared: "${intent.type}"`,
        { processManager: args.manager.name, intentType: intent.type },
      );
    }
    return {
      intentType: intent.type,
      messageKey: def.messageKey(intent.payload),
      tenantId: args.tenantId,
      payload: JSON.stringify(intent.payload),
    };
  });
}

export function createProcessRuntime(deps: ProcessRuntimeDeps): ProcessRuntime {
  const metrics = deps.metrics ?? noopMetrics;
  const outcomes = metrics.counter({
    name: "es_process_step_outcomes_total",
    help: "Process manager step outcomes, by process and kind.",
    labelNames: ["process", "kind"],
  });

  async function persist(args: {
    readonly manager: BuiltProcessManager;
    readonly key: ProcessInstanceKey;
    readonly tenantId: string;
    readonly state: unknown;
    readonly expectedRevision: number;
    readonly nextWakeAt: number | null;
    readonly intents: readonly {
      readonly type: string;
      readonly payload: unknown;
    }[];
  }): Promise<void> {
    await deps.processStore.save({
      key: args.key,
      tenantId: args.tenantId,
      state: args.state,
      stateVersion: args.manager.stateVersion,
      expectedRevision: args.expectedRevision,
      nextWakeAt: clampWake(args.nextWakeAt, deps.clock.now()),
    });
    if (args.intents.length > 0) {
      await deps.outbox.stage(
        toOutboxRows({
          tenantId: args.tenantId,
          manager: args.manager,
          intents: args.intents,
        }),
      );
    }
  }

  async function wake(
    manager: BuiltProcessManager,
    args: ProcessWakeArgs,
  ): Promise<{ readonly ran: boolean }> {
    if (!manager.onWake) return { ran: false };
    const read = await loadState(deps.processStore, manager, args.key);
    if (read.kind === "absent") return { ran: false };

    const ctx: ProcessContext = {
      now: deps.clock.now(),
      tenantId: args.tenantId,
      processKey: args.key.processKey,
    };
    const step = manager.onWake(read.state, ctx);

    await persist({
      manager,
      key: args.key,
      tenantId: args.tenantId,
      state: step.state,
      expectedRevision: read.revision,
      nextWakeAt: step.nextWakeAt,
      intents: step.intents,
    });
    outcomes.inc({ process: manager.name, kind: "woken" });
    return { ran: true };
  }

  return {
    async deliver(manager, args) {
      return withSpan(
        "es.process.deliver",
        { "es.process": manager.name, "es.processKey": args.key.processKey },
        async () => {
          const read = await loadState(deps.processStore, manager, args.key);
          let state: unknown =
            read.kind === "found" ? read.state : manager.init();
          const revision = read.kind === "found" ? read.revision : 0;

          let ran = false;
          let applied = 0;
          let nextWakeAt: number | null = null;
          const intents: { type: string; payload: unknown }[] = [];
          const ctx: ProcessContext = {
            now: deps.clock.now(),
            tenantId: args.tenantId,
            processKey: args.key.processKey,
          };

          for (const event of args.events) {
            const step = manager.evolve(state, event, ctx);
            if (step === null) continue;
            state = step.state;
            intents.push(...step.intents);
            nextWakeAt = step.nextWakeAt;
            ran = true;
            applied += 1;
          }

          if (!ran) {
            outcomes.inc({ process: manager.name, kind: "noop" });
            return { applied: 0 };
          }

          try {
            await persist({
              manager,
              key: args.key,
              tenantId: args.tenantId,
              state,
              expectedRevision: revision,
              nextWakeAt,
              intents,
            });
          } catch (error) {
            outcomes.inc({ process: manager.name, kind: "failed" });
            throw error;
          }

          outcomes.inc({ process: manager.name, kind: "applied" });
          return { applied };
        },
      );
    },

    wake,

    async pollDue(managers, args) {
      const due = await deps.processStore.due(deps.clock.now(), args.limit);
      let woken = 0;
      for (const key of due) {
        const manager = managers[key.processName];
        if (!manager) continue;
        // The due row carries its own tenant, so nothing has to resolve one
        // from the key — the wake builds its whole context from this.
        const { ran } = await wake(manager, { key, tenantId: key.tenantId });
        if (ran) woken += 1;
      }
      return { woken };
    },

    async ensureArmed(manager, args) {
      const read = await loadState(deps.processStore, manager, args.key);
      if (read.kind === "found") return { armed: false };
      await deps.processStore.save({
        key: args.key,
        tenantId: args.tenantId,
        state: manager.init(),
        stateVersion: manager.stateVersion,
        expectedRevision: 0,
        nextWakeAt: args.initialWakeAt,
      });
      return { armed: true };
    },
  };
}
