// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEventData,
  type PulledUsageRetractedEventData,
} from "@langwatch/enterprise-governance-contract";
import {
  buildIntentHandlers,
  buildProcessDefinition,
  buildProcessManager,
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
} from "@langwatch/eventing";

import type {
  PulledUsageLedgerRepository,
  PulledUsageLedgerRow,
} from "../../app/governance.members.ts";
import {
  PULLED_USAGE_LEDGER_PROCESS_NAME,
  PulledUsageLedgerProcess,
} from "../pulled-usage-ledger.process.ts";
import type {
  PulledUsageRetractionDeps,
  RetractCommandEnvelope,
} from "../pulled-usage-retraction.intent.ts";

export const T0 = Date.UTC(2026, 7, 3, 0, 0, 0);
export const OCCURRED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);
export const GOV_PROJECT = "proj-gov-ledger";
export const ORG_ID = "org-ledger";
export const RESTATEMENT_KEY = "example:ledger:sub-1:2026-08-01";

export const LEDGER_REF = {
  processName: PULLED_USAGE_LEDGER_PROCESS_NAME,
  projectId: GOV_PROJECT,
  processKey: RESTATEMENT_KEY,
};

export function observation(
  overrides: Partial<PulledUsageObservedEventData> = {},
): PulledUsageObservedEventData {
  return {
    itemKey: "item-ledger",
    restatementKey: RESTATEMENT_KEY,
    source: "azure_cost_management",
    ingestionSourceId: "src-ledger",
    organizationId: ORG_ID,
    teamId: "team-ledger",
    projectId: null,
    model: "azure/meter-cognitive-services",
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    costNanoMinor: 12_000_000_000,
    currencyCode: "USD",
    costNanoUsd: 12_000_000_000,
    rateVersion: null,
    costBasis: "provider_reported",
    costStatus: "exact",
    rawActorId: "",
    agentId: "",
    occurredAtMs: OCCURRED_AT,
    observedAtMs: T0,
    ...overrides,
  };
}

class RecordingLedger implements PulledUsageLedgerRepository {
  readonly rows: PulledUsageLedgerRow[] = [];
  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    this.rows.push(...rows);
    return Promise.resolve();
  }
}

class RecordingRetraction implements PulledUsageRetractionDeps {
  readonly sent: (PulledUsageRetractedEventData & RetractCommandEnvelope)[] = [];
  readonly asked: string[] = [];
  enabled = true;
  sendRetractPulledUsage = (data: PulledUsageRetractedEventData & RetractCommandEnvelope) => {
    this.sent.push(data);
    return Promise.resolve();
  };
  retractionEnabled = (organizationId: string) => {
    this.asked.push(organizationId);
    return Promise.resolve(this.enabled);
  };
}

/** The ledger process as the runtime mounts it, driven through the real service and outbox. */
export function ledgerRuntime() {
  const ledger = new RecordingLedger();
  const retraction = new RecordingRetraction();
  const config = buildProcessManager({
    name: PULLED_USAGE_LEDGER_PROCESS_NAME,
    applier: PulledUsageLedgerProcess.create({ ledger, retraction }).processManager(),
  }).config;
  const store = InMemoryProcessStore.createForTesting();
  const service = new ProcessManagerService({ store, definition: buildProcessDefinition(config) });
  const dispatcher = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(config),
    processNames: [PULLED_USAGE_LEDGER_PROCESS_NAME],
  });
  let clock = T0;

  const observe = (data: PulledUsageObservedEventData) =>
    service.handleEvent({
      envelope: {
        eventId: `obs:${data.restatementKey}:${data.observedAtMs}`,
        eventType: PULLED_USAGE_EVENT_TYPES.OBSERVED,
        occurredAt: data.occurredAtMs,
        tenantId: GOV_PROJECT,
        projectId: GOV_PROJECT,
        processKey: data.restatementKey,
        payload: data,
      },
      now: clock,
    });

  const drainOutbox = async (passes = 4) => {
    for (let pass = 0; pass < passes; pass++) {
      clock += 1_000;
      await dispatcher.runOnce({ now: clock, limit: 50 });
    }
  };

  return { store, ledger, retraction, observe, drainOutbox };
}
