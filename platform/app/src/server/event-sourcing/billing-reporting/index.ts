/**
 * The billing-reporting pipeline (ADR-098, ADR-099, ADR-100, ADR-105).
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 *
 * `recordBillableEvent` is the command bridge (ADR-105 consequences): the
 * only way another pipeline's own billable activity reaches this one, since
 * this pipeline cannot see another's events. Its own `billableEventRecorded`
 * feeds three members: the `billableEventsMeter` map, which records the
 * deduplicated ledger row; `billingMeterPoke`, one process instance per
 * organization, which re-reads and reports that organization's month total;
 * and `billingMeterSweep`, one global instance, which is the durability
 * guarantee behind the poke.
 */

import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import { type ClickHouseClient, clickhouseAppend } from "@langwatch/clickhouse";
import { type GroupKey, definePipeline, processGroupKey } from "@langwatch/event-sourcing";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import type { OrganizationForBilling } from "~/server/app-layer/organizations/repositories/organization.repository";
import { resolveOrganizationId as resolveOrganizationIdDefault } from "~/server/organizations/resolveOrganizationId";
import { TtlCache } from "~/server/utils/ttlCache";
import { toBillableEventRow, toBillableEventsTableRow } from "./billableEventsMeter.projection";
import {
  BILLING_METER_POKE_PROCESS_NAME,
  billingMeterPokeIntents,
  billingMeterPokeOn,
  billingMeterPokeStateSchema,
  initBillingMeterPokeState,
} from "./billingMeterPoke.process";
import {
  BILLING_METER_SWEEP_PROCESS_NAME,
  type BillingMeterSweepPorts,
  billingMeterSweepIntents,
  billingMeterSweepOn,
  billingMeterSweepOnWake,
  billingMeterSweepStateSchema,
  initBillingMeterSweepState,
} from "./billingMeterSweep.process";
import { BILLING_PIPELINE_NAME, BILLING_PIPELINE_PREFIX, billingReportingEvents } from "./events";
import {
  type RecordBillableEventPorts,
  billableSourceEventSchema,
  recordBillableEvent,
} from "./recordBillableEvent.command";
import type { OrganizationCache } from "./reportUsage";
import { billableEventsTable } from "./table";

const ORG_CACHE_TTL_MS = 60 * 1000;
/** A `__global__` marker, not a real organization id: the sweep is one
 *  instance for the whole deployment, so it has no owning organization. */
const GLOBAL_SWEEP_KEY = "__global__";

/** ADR-100 decision 4: content-addressed, one lane per source event. */
export function recordBillableEventGroupKey(args: { tenantId: string; eventId: string }): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "recordBillableEvent" },
    scope: { kind: "aggregate", aggregateType: BILLING_PIPELINE_NAME, aggregateId: args.eventId },
  };
}

/** A `partition` lane per project: this store is append-shaped, so any
 *  number of events sharing a lane may coalesce into one insert. */
export function billableEventsMeterGroupKey(args: { tenantId: string }): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "billableEventsMeter" },
    scope: { kind: "partition", parts: [args.tenantId] },
  };
}

/** One poke instance per organization: two organizations' pokes must never
 *  share a lane. */
export function billingMeterPokeGroupKey(args: { organizationId: string }): GroupKey {
  return processGroupKey(
    { name: BILLING_METER_POKE_PROCESS_NAME },
    { tenantId: args.organizationId, processKey: args.organizationId },
  );
}

/** The sweep is one instance for the whole deployment, waking on a fixed
 *  interval rather than on any organization's events. */
export function billingMeterSweepGroupKey(): GroupKey {
  return processGroupKey(
    { name: BILLING_METER_SWEEP_PROCESS_NAME },
    { tenantId: GLOBAL_SWEEP_KEY, processKey: GLOBAL_SWEEP_KEY },
  );
}

export interface BillingReportingPipelineDeps {
  readonly client: ClickHouseClient;
  readonly organizations: Pick<OrganizationService, "getOrganizationForBilling">;
  readonly billingCheckpoints: BillingCheckpointService;
  /** Read per dispatch: usage reporting is SaaS-only, absent from a
   *  self-hosted build entirely. */
  readonly getUsageReportingService: () => UsageReportingService | undefined;
  readonly queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  /** Organizations whose month total must be re-read for the sweep — see
   *  `billingMeterSweep.process.ts`. */
  readonly listOrganizationsToReport: (params: { billingMonth: string }) => Promise<string[]>;
  readonly pruneDispatchedIntentsBefore: (params: { before: number }) => Promise<number>;
  readonly resolveOrganizationId?: (projectId: string) => Promise<string | undefined>;
  /** Defaulted to a TTL cache; injected so a test never has to reach through
   *  the module graph to stub it. */
  readonly organizationCache?: OrganizationCache;
  /**
   * The poke is gated on this; the sweep is not. On a self-hosted build the
   * candidate query and the Stripe call both degrade to nothing on their
   * own, so the sweep costs an empty read an hour and dispatches nothing —
   * the poke has no equivalent self-gate, since it runs off every billable
   * event rather than a bounded schedule.
   */
  readonly isSaas: boolean;
}

export function createBillingReportingPipeline(deps: BillingReportingPipelineDeps) {
  const resolveOrganizationId = deps.resolveOrganizationId ?? resolveOrganizationIdDefault;
  const organizationCache =
    deps.organizationCache ?? new TtlCache<OrganizationForBilling>(ORG_CACHE_TTL_MS, "ttlcache:billing:orgData:");

  const meterStore = clickhouseAppend({
    client: deps.client,
    table: billableEventsTable,
    toRow: toBillableEventsTableRow,
  });

  const reportUsagePorts = {
    organizations: deps.organizations,
    organizationCache,
    billingCheckpoints: deps.billingCheckpoints,
    getUsageReportingService: deps.getUsageReportingService,
    queryBillableEventsTotal: deps.queryBillableEventsTotal,
  };
  const sweepPorts: BillingMeterSweepPorts = {
    ...reportUsagePorts,
    listOrganizationsToReport: deps.listOrganizationsToReport,
    pruneDispatchedIntentsBefore: deps.pruneDispatchedIntentsBefore,
  };
  const recordPorts: RecordBillableEventPorts = { resolveOrganizationId };

  return definePipeline(BILLING_PIPELINE_NAME)
    .prefix(BILLING_PIPELINE_PREFIX)
    .events(billingReportingEvents)
    .id({ billableEventRecorded: (data) => data.organizationId })
    .withCommand("recordBillableEvent", {
      input: billableSourceEventSchema,
      handle: recordBillableEvent(recordPorts),
    })
    .withMap("billableEventsMeter", {
      on: { billableEventRecorded: toBillableEventRow },
      store: meterStore,
    })
    .withProcessManager(BILLING_METER_POKE_PROCESS_NAME, {
      state: billingMeterPokeStateSchema,
      init: initBillingMeterPokeState,
      intents: billingMeterPokeIntents(reportUsagePorts),
      on: billingMeterPokeOn,
      enabled: deps.isSaas,
    })
    .withProcessManager(BILLING_METER_SWEEP_PROCESS_NAME, {
      state: billingMeterSweepStateSchema,
      init: initBillingMeterSweepState,
      intents: billingMeterSweepIntents(sweepPorts),
      on: billingMeterSweepOn,
      onWake: billingMeterSweepOnWake,
    })
    .build();
}
