// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The drift check driven against an in-memory store, which is enough to pin
 * what the process DECIDES: which day a charge marks, which moment it arms,
 * and what a due check asks for.
 *
 * The definition under test is the exact one the runtime mounts, built through
 * the pipeline's own applier and driven through the real process service and
 * the real outbox dispatcher — so the marking, the arming and the wake are the
 * runtime's, not the test's.
 *
 * Every delivery goes through the definition's own `keyBy` and `toPayload`
 * rather than a hand-written envelope. Those two are the whole reason one
 * organization's charges gather on one instance instead of scattering across
 * one instance per charge, so a test that computed the key itself would prove
 * nothing about the shape that ships.
 *
 * `createWatchHarness` is a FACTORY and registers its own `beforeEach`.
 * Nothing mutable lives at module scope: the helpers below are pure functions
 * of a `WatchRuntime` the factory owns, so the unit lane's shared module
 * registry has no variable here to hand from one file to the next.
 *
 * @see specs/governance/cost-rollup-watch.feature
 */
import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { GOVERNANCE_COST_SOURCE } from "@ee/governance/projections/governanceCostRollup.constants";
import { nanoid } from "nanoid";
import { beforeEach, vi } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type { ProcessManagerConfig } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  InMemoryProcessStore,
  type ProcessDefinition,
  ProcessManagerService,
} from "~/server/event-sourcing/process-manager";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager/outbox/outboxDispatcherService";
import type { ProcessEventEnvelope } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";

import {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  type CostRollupWatchState,
  costRollupWatchPM,
} from "../costRollupWatch.process";

/** An ordinary working morning, hours after that day's slot has passed. */
export const NOW = Date.UTC(2026, 8, 10, 8, 0, 0);
export const TODAY = "2026-09-10";
export const YESTERDAY = "2026-09-09";
export const YESTERDAY_MS = Date.UTC(2026, 8, 9, 22, 0, 0);
export const LAST_TUESDAY = "2026-09-01";
export const LAST_TUESDAY_MS = Date.UTC(2026, 8, 1, 9, 0, 0);

/** The slot every charge recorded at `NOW` arms. */
export const TONIGHT = Date.UTC(2026, 8, 11, 4, 23, 0);

type WatchConfig = ProcessManagerConfig<any, any, PulledUsageProcessingEvent>;

/**
 * Everything one `beforeEach` rebuilds, held in one object so the helpers can
 * be plain functions instead of closures over a pile of `let`s. The object's
 * identity is stable across rebuilds — its fields are replaced, not the box —
 * which is what lets the returned facade keep reading the live runtime.
 */
interface WatchRuntime {
  store: InMemoryProcessStore;
  service: ProcessManagerService<CostRollupWatchState>;
  dispatcher: OutboxDispatcherService;
  compareDay: ReturnType<typeof vi.fn>;
  config: WatchConfig;
  clock: number;
}

function buildDefinition(compareDay: ReturnType<typeof vi.fn>) {
  return buildProcessManager<PulledUsageProcessingEvent>({
    name: COST_ROLLUP_WATCH_PROCESS_NAME,
    applier: costRollupWatchPM({ comparator: { compareDay } as never }),
  });
}

/** The runtime as a fresh `beforeEach` leaves it. */
function freshRuntime(): WatchRuntime {
  // Agreement, not `undefined`: the handler reads the mismatches back to
  // decide whether to look again, so a stub that answers nothing is a stub the
  // handler cannot use. These suites are about which comparisons are ASKED
  // for; what the ladder does with a disagreement is next door, in
  // `costRollupWatch.settling.unit.test.ts`.
  const compareDay = vi.fn().mockResolvedValue({
    day: "",
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
    mismatches: [],
    lagMs: 0,
    behind: [],
  });
  const definition = buildDefinition(compareDay);
  const store = new InMemoryProcessStore();
  return {
    store,
    compareDay,
    clock: NOW,
    config: definition.config as WatchConfig,
    service: new ProcessManagerService<CostRollupWatchState>({
      store,
      definition: buildProcessDefinition(
        definition.config,
      ) as ProcessDefinition<CostRollupWatchState>,
    }),
    dispatcher: new OutboxDispatcherService({
      store,
      handlers: buildIntentHandlers(definition.config),
      processNames: [COST_ROLLUP_WATCH_PROCESS_NAME],
    }),
  };
}

/** What a test may vary about one charge. The tenant defaults to the harness's. */
export interface ChargeOverrides {
  tenantId?: string;
  occurredAtMs?: unknown;
  eventType?: string;
  eventId?: string;
  aggregateId?: string;
}

/**
 * One charge, as the log holds it: the tenant it belongs to, the item stream
 * it arrived on, and the moment it HAPPENED.
 */
function makeCharge({
  tenantId,
  occurredAtMs = NOW,
  eventType = PULLED_USAGE_EVENT_TYPES.OBSERVED,
  eventId = `evt-${nanoid(10)}`,
  aggregateId = `item-${nanoid(6)}`,
}: ChargeOverrides & { tenantId: string }): PulledUsageProcessingEvent {
  return {
    id: eventId,
    type: eventType,
    tenantId,
    aggregateId,
    occurredAt: occurredAtMs,
    data: { restatementKey: aggregateId, occurredAtMs },
  } as unknown as PulledUsageProcessingEvent;
}

/** Delivers one charge exactly as the generated subscriber would. */
async function deliver(
  runtime: WatchRuntime,
  event: PulledUsageProcessingEvent,
  now: number,
): Promise<void> {
  const envelope: ProcessEventEnvelope = {
    eventId: event.id,
    eventType: event.type,
    occurredAt: event.occurredAt,
    tenantId: event.tenantId,
    projectId: event.tenantId,
    processKey: runtime.config.keyBy!(event),
    payload: runtime.config.toPayload!(event),
  };
  await runtime.service.handleEvent({ envelope, now });
}

function refFor(runtime: WatchRuntime, tenantId: string) {
  return {
    processName: COST_ROLLUP_WATCH_PROCESS_NAME,
    projectId: tenantId,
    processKey: runtime.config.keyBy!(makeCharge({ tenantId })),
  };
}

async function instanceOf(runtime: WatchRuntime, tenantId: string) {
  return await runtime.store.findByRef<CostRollupWatchState>({
    ref: refFor(runtime, tenantId),
  });
}

/** Runs the armed check the way the wake worker does, at its own slot. */
async function runDueCheck(
  runtime: WatchRuntime,
  tenantId: string,
): Promise<void> {
  const instance = await instanceOf(runtime, tenantId);
  if (!instance?.nextWakeAt) {
    throw new Error(`no check armed for ${tenantId}`);
  }
  runtime.clock = instance.nextWakeAt;
  await runtime.service.handleWake({
    wake: {
      ref: refFor(runtime, tenantId),
      revision: instance.revision,
      wakeAt: instance.nextWakeAt,
    },
    now: runtime.clock,
  });
}

async function drainOutbox(
  runtime: WatchRuntime,
  passes: number,
): Promise<void> {
  for (let i = 0; i < passes; i++) {
    runtime.clock += 1_000;
    await runtime.dispatcher.runOnce({ now: runtime.clock, limit: 500 });
  }
}

export function createWatchHarness({ tenantPrefix }: { tenantPrefix: string }) {
  const ns = `${tenantPrefix}-${nanoid(8)}`;
  /** The organization's hidden governance project — the tenant of every row. */
  const TENANT = `proj-gov-${ns}`;
  const OTHER_TENANT = `proj-gov-other-${ns}`;
  const runtime = freshRuntime();

  beforeEach(() => {
    Object.assign(runtime, freshRuntime());
  });

  return {
    ns,
    TENANT,
    OTHER_TENANT,
    charge: (overrides: ChargeOverrides = {}) =>
      makeCharge({ ...overrides, tenantId: overrides.tenantId ?? TENANT }),
    record: (
      event: PulledUsageProcessingEvent,
      { now = runtime.clock }: { now?: number } = {},
    ) => deliver(runtime, event, now),
    refFor: (tenantId: string) => refFor(runtime, tenantId),
    instanceOf: (tenantId = TENANT) => instanceOf(runtime, tenantId),
    stateOf: async (tenantId = TENANT): Promise<CostRollupWatchState> => {
      const instance = await instanceOf(runtime, tenantId);
      if (!instance) throw new Error(`no process instance for ${tenantId}`);
      return instance.state;
    },
    runDueCheck: (tenantId = TENANT) => runDueCheck(runtime, tenantId),
    drainOutbox: (passes = 4) => drainOutbox(runtime, passes),
    get store() {
      return runtime.store;
    },
    get compareDay() {
      return runtime.compareDay;
    },
    get clock() {
      return runtime.clock;
    },
    set clock(value: number) {
      runtime.clock = value;
    },
  };
}
