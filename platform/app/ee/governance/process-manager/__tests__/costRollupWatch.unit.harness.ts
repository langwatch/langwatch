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
 * Nothing mutable lives at module scope: the unit lane runs files with a
 * shared module registry, so a module-level `let` here would be one variable
 * shared by every file that imported it.
 *
 * @see specs/governance/cost-rollup-watch.feature
 */
import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
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

export function createWatchHarness({ tenantPrefix }: { tenantPrefix: string }) {
  const ns = `${tenantPrefix}-${nanoid(8)}`;
  /** The organization's hidden governance project — the tenant of every row. */
  const TENANT = `proj-gov-${ns}`;
  const OTHER_TENANT = `proj-gov-other-${ns}`;

  let store: InMemoryProcessStore;
  let service: ProcessManagerService<CostRollupWatchState>;
  let dispatcher: OutboxDispatcherService;
  let compareDay: ReturnType<typeof vi.fn>;
  let config: ProcessManagerConfig<any, any, PulledUsageProcessingEvent>;
  let clock: number;

  function definition() {
    return buildProcessManager<PulledUsageProcessingEvent>({
      name: COST_ROLLUP_WATCH_PROCESS_NAME,
      applier: costRollupWatchPM({
        comparator: { compareDay } as never,
      }),
    });
  }

  /**
   * One charge, as the log holds it: the tenant it belongs to, the item stream
   * it arrived on, and the moment it HAPPENED.
   */
  function charge({
    tenantId = TENANT,
    occurredAtMs = NOW,
    eventType = PULLED_USAGE_EVENT_TYPES.OBSERVED,
    eventId = `evt-${nanoid(10)}`,
    aggregateId = `item-${nanoid(6)}`,
  }: {
    tenantId?: string;
    occurredAtMs?: unknown;
    eventType?: string;
    eventId?: string;
    aggregateId?: string;
  } = {}): PulledUsageProcessingEvent {
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
  async function record(
    event: PulledUsageProcessingEvent,
    { now = clock }: { now?: number } = {},
  ): Promise<void> {
    const envelope: ProcessEventEnvelope = {
      eventId: event.id,
      eventType: event.type,
      occurredAt: event.occurredAt,
      tenantId: event.tenantId,
      projectId: event.tenantId,
      processKey: config.keyBy!(event),
      payload: config.toPayload!(event),
    };
    await service.handleEvent({ envelope, now });
  }

  function refFor(tenantId: string) {
    return {
      processName: COST_ROLLUP_WATCH_PROCESS_NAME,
      projectId: tenantId,
      processKey: config.keyBy!(charge({ tenantId })),
    };
  }

  async function instanceOf(tenantId = TENANT) {
    return await store.findByRef<CostRollupWatchState>({
      ref: refFor(tenantId),
    });
  }

  async function stateOf(tenantId = TENANT): Promise<CostRollupWatchState> {
    const instance = await instanceOf(tenantId);
    if (!instance) throw new Error(`no process instance for ${tenantId}`);
    return instance.state;
  }

  /** Runs the armed check the way the wake worker does, at its own slot. */
  async function runDueCheck(tenantId = TENANT): Promise<void> {
    const instance = await instanceOf(tenantId);
    if (!instance?.nextWakeAt) {
      throw new Error(`no check armed for ${tenantId}`);
    }
    clock = instance.nextWakeAt;
    await service.handleWake({
      wake: {
        ref: refFor(tenantId),
        revision: instance.revision,
        wakeAt: instance.nextWakeAt,
      },
      now: clock,
    });
  }

  async function drainOutbox(passes = 4): Promise<void> {
    for (let i = 0; i < passes; i++) {
      clock += 1_000;
      await dispatcher.runOnce({ now: clock, limit: 500 });
    }
  }

  beforeEach(() => {
    clock = NOW;
    compareDay = vi.fn().mockResolvedValue(undefined);
    config = definition().config as typeof config;
    store = new InMemoryProcessStore();
    service = new ProcessManagerService<CostRollupWatchState>({
      store,
      definition: buildProcessDefinition(
        definition().config,
      ) as ProcessDefinition<CostRollupWatchState>,
    });
    dispatcher = new OutboxDispatcherService({
      store,
      handlers: buildIntentHandlers(definition().config),
      processNames: [COST_ROLLUP_WATCH_PROCESS_NAME],
    });
  });

  return {
    ns,
    TENANT,
    OTHER_TENANT,
    charge,
    record,
    refFor,
    instanceOf,
    stateOf,
    runDueCheck,
    drainOutbox,
    get store() {
      return store;
    },
    get compareDay() {
      return compareDay;
    },
    get clock() {
      return clock;
    },
    set clock(value: number) {
      clock = value;
    },
  };
}
