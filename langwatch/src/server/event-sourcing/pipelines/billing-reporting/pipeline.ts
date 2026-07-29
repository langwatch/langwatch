import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { Event } from "../../domain/types";
import { ReportUsageForMonthCommand } from "./commands/reportUsageForMonth.command";

export const BILLING_REPORTING_PIPELINE_NAME = "billing_reporting" as const;

/**
 * ADR-077 Rule 1 — the command instance is constructed here, from the services
 * and ports it needs. Nothing in this interface is a value the builder
 * registers.
 */
export interface BillingReportingPipelineDeps {
  organizations: OrganizationService;
  billingCheckpoints: BillingCheckpointService;
  /**
   * Read per dispatch rather than held: usage reporting is SaaS-only and is
   * absent from an OSS build entirely.
   */
  getUsageReportingService: () => UsageReportingService | undefined;
  queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  /** ADR-077 §5 — identity-keyed dispatch, here into this pipeline's own command. */
  commands: CommandBus;
}

/**
 * Creates the billing-reporting pipeline definition.
 *
 * Command-only pipeline — no projections, no reactors.
 */
export function createBillingReportingPipeline(
  deps: BillingReportingPipelineDeps,
) {
  return definePipeline<Event>()
    .withName(BILLING_REPORTING_PIPELINE_NAME)
    .withAggregateType("billing_report")
    .withCommandInstance(
      "reportUsageForMonth",
      ReportUsageForMonthCommand,
      new ReportUsageForMonthCommand({
        organizations: deps.organizations,
        billingCheckpoints: deps.billingCheckpoints,
        getUsageReportingService: deps.getUsageReportingService,
        queryBillableEventsTotal: deps.queryBillableEventsTotal,
        // The convergence loop re-dispatches this very command. The bus port
        // binds now and resolves at send time, so the pipeline can name its own
        // command while it is still being built — no `getPipeline(name)` string
        // lookup returning `any`, and no registration-order constraint.
        selfDispatch: deps.commands.port(ReportUsageForMonthCommand),
      }),
      {
        delay: 300_000, // 5 min delay (initial + re-trigger)
        deduplication: {
          makeId: (p: { organizationId: string; billingMonth: string }) =>
            `${p.organizationId}:${p.billingMonth}`,
          ttlMs: 310_000, // 310s > 300s delay — prevents thundering herd, self-dispatch still works via replace logic
        },
      },
    )
    .build();
}
