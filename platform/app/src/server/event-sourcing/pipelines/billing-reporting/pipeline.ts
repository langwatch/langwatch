import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { Event } from "../../domain/types";
import { ReportUsageForMonthCommand } from "./commands/reportUsageForMonth.command";
import {
  BILLING_METER_SWEEP_PROCESS_NAME,
  billingMeterSweepPM,
} from "./process-manager/billingMeterSweep.process";

export const BILLING_REPORTING_PIPELINE_NAME = "billing_reporting" as const;

/**
 * How long a staged report waits before it runs, so a burst of pokes collapses
 * onto one Stripe read rather than one per event.
 */
const REPORT_DEBOUNCE_MS = 300_000;

/**
 * The dedup window for `${organizationId}:${billingMonth}`.
 *
 * Paired with `extend: false`, and that pairing is the whole point. The stage
 * script re-`ZADD`s an already-staged job's dispatch score to
 * `occurredAt + delay` on every squash *unless* the dedup declines to extend
 * (`groupQueue.ts` — `shouldExtend = dedup.extend !== false`), and jobs only
 * dispatch once their score is in the past. An extending window therefore
 * pushes the report five minutes further out every time a poke lands, so the
 * organizations with the most continuous billable traffic — the ones with the
 * largest invoices — are exactly the ones whose report never comes due. Not
 * extending closes the window on schedule; the poke that arrives after it
 * opens a fresh one. `graphTriggerActivity` declines for the same reason.
 */
const REPORT_DEDUP_TTL_MS = 310_000;

/**
 * ADR-082 Rule 1 — the command instance is constructed here, from the services
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
  /** ADR-082 §5 — identity-keyed dispatch, here into this pipeline's own command. */
  commands: CommandBus;
  /**
   * Arms the scheduled safety net.
   *
   * REQUIRED, and required in the type rather than only in practice — because
   * the one time it was optional it shipped unsupplied, and nothing said so.
   * A build without it reports usage exclusively off the per-event poke, so a
   * poke whose dispatch failed every retry, or an organization that goes quiet
   * for the rest of the month, leaves that month's tail unreported. That is
   * unbilled revenue, and it is silent: the sweep's own unit tests still pass,
   * because a pipeline's tests say nothing about whether anything wires it.
   *
   * Two guards now, deliberately at different layers. This type makes omitting
   * it a compile error at every call site; `__tests__/pipeline.sweepWiring.unit.test.ts`
   * separately asserts the composition root actually mounts the process
   * manager, which a satisfied type cannot tell you (a caller can satisfy the
   * type with a stub that lists nothing).
   */
  sweep: BillingReportingSweepDeps;
}

/**
 * What the sweep needs from outside. The dispatch port is deliberately absent:
 * the pipeline owns its own command and wires it below, so no caller can point
 * the safety net at a different command than the poke uses.
 */
export interface BillingReportingSweepDeps {
  /**
   * Organizations whose month total must be re-read and reported. Must include
   * every organization that could have unreported usage in that month — an
   * organization missing from this set is one the safety net cannot rescue.
   */
  listOrganizationsToReport: (params: {
    billingMonth: string;
  }) => Promise<string[]>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
}

/**
 * Creates the billing-reporting pipeline definition.
 *
 * One command, and — when the sweep deps are supplied — one scheduled process
 * manager that is the durability guarantee behind it. The command itself is
 * unchanged by the schedule: it reads the month total as a level and derives
 * its Stripe identifier from that level, which is what makes an extra trigger
 * safe to add at all.
 */
export function createBillingReportingPipeline(
  deps: BillingReportingPipelineDeps,
) {
  // The convergence loop re-dispatches this very command, and so does the
  // sweep. The bus port binds now and resolves at send time, so the pipeline
  // can name its own command while it is still being built — no
  // `getPipeline(name)` string lookup returning `any`, and no registration-order
  // constraint.
  const reportUsageForMonth = deps.commands.port(ReportUsageForMonthCommand);

  let builder = definePipeline<Event>()
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
        selfDispatch: reportUsageForMonth,
      }),
      {
        delay: REPORT_DEBOUNCE_MS,
        deduplication: {
          makeId: (p: { organizationId: string; billingMonth: string }) =>
            `${p.organizationId}:${p.billingMonth}`,
          // Longer than the debounce so the key still points at the staged job
          // when that job comes due, rather than expiring first and letting a
          // second job stage for the same window.
          ttlMs: REPORT_DEDUP_TTL_MS,
          extend: false,
        },
      },
    );

  // Unconditional. The sweep IS the delivery guarantee, so mounting it must not
  // depend on a caller remembering to ask for it — that conditional is how it
  // shipped unmounted, with every one of its own tests still green.
  builder = builder.withProcessManager(
    BILLING_METER_SWEEP_PROCESS_NAME,
    billingMeterSweepPM({
      listOrganizationsToReport: deps.sweep.listOrganizationsToReport,
      dispatchReport: reportUsageForMonth,
      deleteDispatchedBefore: deps.sweep.deleteDispatchedBefore,
    }),
  );

  return builder.build();
}
