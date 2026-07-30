/**
 * The billing-reporting pipeline (ADR-098, ADR-099, ADR-100, ADR-102).
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 *
 * The **meter** records every billable event, one deduplicated row each. The
 * **poke** is the losable fast path; the **sweep** re-reports hourly whether or
 * not anything poked, and is the guarantee. Both dispatch
 * `reportUsageForMonth`, which reads the month total as a LEVEL.
 */

import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import {
  type ClickHouseClient,
  clickhouseAppend,
  deriveAppendMapping,
} from "@langwatch/clickhouse";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { resolveOrganizationId as resolveOrganizationIdDefault } from "~/server/organizations/resolveOrganizationId";

import { BILLING_REPORTING_PIPELINE_NAME } from "./constants";
import {
  BILLABLE_EVENT_TYPES,
  type BillableEventMeterRecord,
  billableEventMeterRecordSchema,
  createBillableEventsMeterProjection,
} from "./meter/billableEventsMeter";
import { billableEventsTable } from "./meter/billableEventsTable";
import {
  type BillingMeterPokeMount,
  createBillingMeterPokeMount,
} from "./reporting/billingMeterPoke";
import {
  type BillingMeterSweepDeps,
  type BillingMeterSweepMount,
  createBillingMeterSweepMount,
} from "./reporting/billingMeterSweep";
import { reportUsageForMonthDispatchOptions } from "./reporting/dispatchOptions";
import {
  type ReportUsageForMonthData,
  reportUsageForMonth,
} from "./reporting/reportUsageForMonth";

export {
  BILLING_GRACE_PERIOD_DAYS,
  BILLING_REPORTING_PIPELINE_NAME,
} from "./constants";
export {
  BILLABLE_EVENT_TYPES,
  type BillableEventMeterRecord,
  type BillableSourceEvent,
  billableEventsMeterGroupKey,
  createBillableEventsMeterProjection,
  extractDeduplicationKey,
  mapBillableEvent,
  renderBillableEventsMeterGroupKey,
} from "./meter/billableEventsMeter";
export { billableEventsTable } from "./meter/billableEventsTable";
export {
  type BillableEventForPoke,
  type BillingMeterPokeDeps,
  type BillingMeterPokeMount,
  billingMeterPokeDedupId,
  billingMeterPokeGroupKey,
  createBillingMeterPokeMount,
  handleBillableEventPoke,
} from "./reporting/billingMeterPoke";
export {
  BILLING_METER_SWEEP_NAME,
  type BillingMeterSweepDeps,
  type BillingMeterSweepMount,
  billingMonthsForSweep,
  createBillingMeterSweepMount,
  runBillingMeterSweep,
} from "./reporting/billingMeterSweep";
export {
  type ReportUsageForMonthDispatchOptions,
  reportUsageForMonthDispatchOptions,
  reportUsageForMonthGroupKey,
} from "./reporting/dispatchOptions";
export {
  type ReportUsageForMonthData,
  type ReportUsageForMonthDeps,
  reportUsageForMonth,
} from "./reporting/reportUsageForMonth";

const logger = createLogger(
  "langwatch:billing-reporting:billable-events-meter",
);

export interface BillingReportingPipelineDeps {
  readonly organizations: Pick<
    OrganizationService,
    "getOrganizationForBilling"
  >;
  readonly billingCheckpoints: BillingCheckpointService;
  /** Read per dispatch: usage reporting is SaaS-only, absent from a
   *  self-hosted build entirely. */
  readonly getUsageReportingService: () => UsageReportingService | undefined;
  readonly queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  readonly resolveOrganizationId?: (
    projectId: string,
  ) => Promise<string | undefined>;
  /**
   * Resolves the `@langwatch/clickhouse` client for an organization's
   * ClickHouse target. No function with this signature exists yet —
   * `~/server/clickhouse/clickhouseClient.ts` hands back a raw
   * `@clickhouse/client` instead — so the composition root owes the bridge.
   */
  readonly getClickHouseClientForOrganization: (
    organizationId: string,
  ) => Promise<ClickHouseClient | null>;
  readonly isSaas: boolean;
}

/** One billable-events row, once the batch's organization and tenant are
 *  attached. Both are batch-level, so they are merged in per `writeBatch`
 *  rather than carried on every record. */
const billableEventRowSchema = billableEventMeterRecordSchema.extend({
  organizationId: z.string(),
  tenantId: z.string(),
});
type BillableEventRow = z.infer<typeof billableEventRowSchema>;

const toBillableEventRow = deriveAppendMapping({
  table: billableEventsTable,
  record: billableEventRowSchema,
  fill: { UpdatedAt: () => new Date() },
});

/**
 * The meter's store. The organization is resolved once per batch, not once per
 * record: every record in one `writeBatch` shares a `BatchContext.tenantId`, so
 * it shares an organization too. `clickhouseAppend` needs one fixed client at
 * construction while the resolver hands back a different client per
 * organization, so the inner stores are memoised by client instance —
 * organizations sharing one ClickHouse target share one store.
 */
function createBillableEventsMeterStore(deps: {
  readonly resolveOrganizationId: (
    projectId: string,
  ) => Promise<string | undefined>;
  readonly getClickHouseClientForOrganization: (
    organizationId: string,
  ) => Promise<ClickHouseClient | null>;
}): AppendStore<BillableEventMeterRecord> {
  const innerStores = new WeakMap<
    ClickHouseClient,
    AppendStore<BillableEventRow>
  >();

  const innerStoreFor = (
    client: ClickHouseClient,
  ): AppendStore<BillableEventRow> => {
    const existing = innerStores.get(client);
    if (existing) return existing;
    const built = clickhouseAppend({
      client,
      table: billableEventsTable,
      toRow: toBillableEventRow,
    });
    innerStores.set(client, built);
    return built;
  };

  return {
    kind: "append",

    async writeBatch(
      records: readonly BillableEventMeterRecord[],
      context: BatchContext,
    ): Promise<void> {
      if (records.length === 0) return;

      const organizationId = await deps.resolveOrganizationId(context.tenantId);
      if (!organizationId) {
        logger.warn(
          { projectId: context.tenantId },
          "orphan project detected, has no organization -- skipping billable event insert",
        );
        return;
      }

      const client =
        await deps.getClickHouseClientForOrganization(organizationId);
      if (!client) {
        logger.debug(
          "ClickHouse not configured, skipping billable event insert",
        );
        return;
      }

      await innerStoreFor(client).writeBatch(
        records.map((record) => ({
          ...record,
          organizationId,
          tenantId: context.tenantId,
        })),
        context,
      );
    },
  };
}

/**
 * The pipeline's whole topology in one place: the meter with its store built at
 * the mount, and the two triggers that both dispatch through one bound
 * `reportUsageForMonth` closure — never a copy per caller, which is what lets a
 * sweep dispatch collapse into a pending poke's.
 */
export function createBillingReportingPipeline(
  deps: BillingReportingPipelineDeps,
) {
  const dispatch = (data: ReportUsageForMonthData): Promise<void> =>
    reportUsageForMonth(data, {
      organizations: deps.organizations,
      billingCheckpoints: deps.billingCheckpoints,
      getUsageReportingService: deps.getUsageReportingService,
      queryBillableEventsTotal: deps.queryBillableEventsTotal,
      selfDispatch: (next) => dispatch(next),
    });

  const meterStore = createBillableEventsMeterStore({
    resolveOrganizationId:
      deps.resolveOrganizationId ?? resolveOrganizationIdDefault,
    getClickHouseClientForOrganization: deps.getClickHouseClientForOrganization,
  });

  return {
    name: BILLING_REPORTING_PIPELINE_NAME,

    meter: {
      table: billableEventsTable,
      eventTypes: BILLABLE_EVENT_TYPES,
      store: meterStore,
      projection: createBillableEventsMeterProjection({ store: meterStore }),
    },

    reportUsageForMonth: dispatch,
    dispatchOptions: reportUsageForMonthDispatchOptions,

    /** Called once per source pipeline, each with its own slice of
     *  `BILLABLE_EVENT_TYPES` — the poke is mounted on all 4. */
    createPokeMount: (eventTypes: readonly string[]): BillingMeterPokeMount =>
      createBillingMeterPokeMount({
        eventTypes,
        isSaas: deps.isSaas,
        resolveOrganizationId: deps.resolveOrganizationId,
        dispatchReport: dispatch,
      }),

    createSweepMount: (
      sweepDeps: Omit<BillingMeterSweepDeps, "dispatchReport">,
    ): BillingMeterSweepMount =>
      createBillingMeterSweepMount({ ...sweepDeps, dispatchReport: dispatch }),
  };
}
