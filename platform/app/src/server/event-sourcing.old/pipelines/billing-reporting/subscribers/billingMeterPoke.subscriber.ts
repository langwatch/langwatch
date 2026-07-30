import { createLogger } from "@langwatch/observability";
import { resolveOrganizationId as resolveOrganizationIdFromProject } from "~/server/organizations/resolveOrganizationId";
import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "../../../../../../ee/billing/services/billableEventsQuery";
import type { Event } from "../../../domain/types";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import type { ReportUsageForMonthCommandData } from "../schemas/commands";
import { BILLING_GRACE_PERIOD_DAYS } from "../schemas/constants";

const logger = createLogger("langwatch:billing-reporting:meter-poke");

/**
 * The dedup window. One job per project per five minutes, which is the whole
 * reason this is affordable behind the busiest event in the product.
 */
const POKE_DEDUP_TTL_MS = 300_000;

/** The dedup key. Exported so a mount can assert what it is collapsing on. */
export function billingMeterPokeDedupId(event: Event): string {
  return `billing_dispatch_${String(event.tenantId)}`;
}

/**
 * One kill switch for all four mounts.
 *
 * Without it each mount derives its own key from the pipeline it sits on
 * (`es-<aggregate>-subscriber-billingMeterPoke-killswitch`), so stopping the
 * poke during an incident means finding and flipping four separate flags —
 * and stopping three of four leaves the billing path running. The key is
 * spelled as the poke's own home pipeline (`billing_report`) rather than any
 * of the pipelines it is mounted on, because none of those is more the poke's
 * owner than the others. `getKillSwitchDescriptors` emits `customKey` when
 * set, so this stays settable from /ops.
 */
export const BILLING_METER_POKE_KILL_SWITCH_KEY =
  "es-billing_report-subscriber-billingMeterPoke-killswitch" as const;

/**
 * The billing poke (ADR-102): a billable event happened somewhere in this
 * project, so re-read the organization's month total and report it.
 *
 * **This is a trigger, not the guarantee.** The guarantee is the scheduled
 * `billingMeterSweep` process manager on the billing-reporting pipeline, which
 * re-reads and re-reports on its own clock. That split is what lets this side
 * stay cheap and fail loudly instead of quietly.
 *
 * Payload-cost shape (ADR-098) — three collapses stack, and they are the
 * reason a per-event subscriber is affordable here at all:
 *
 *   - `deduplication` keys on the project and holds for five minutes, so a
 *     project ingesting continuously mints ONE job per window rather than one
 *     per span. The collapse is not group-scoped, but it IS per mount: the
 *     queue namespaces the key as
 *     `${pipeline}/subscriber/billingMeterPoke/billing_dispatch_<projectId>`,
 *     so a project active on all four pipelines mints up to four pokes per
 *     window where the single global reactor this replaced minted one. Four
 *     five-minute-collapsed jobs per project is still the affordable end of
 *     the trade; the point is that "ONE job per window" is per pipeline, not
 *     per project.
 *   - The command it wakes dedups again on `${organizationId}:${billingMonth}`
 *     for 310s WITHOUT extending that window, so the projects of one
 *     organization collapse onto one report and the report still comes due on
 *     schedule however many pokes land inside it.
 *   - That command reads the month total as a LEVEL rather than an increment,
 *     so a poke that lands is worth exactly as much as ten, and a poke that is
 *     lost costs nothing the next poke (or the sweep) does not recover.
 *
 * `disabled` is wired from `isSaas` rather than left to the mount: usage
 * reporting exists only in the SaaS build, and a mount that forgot to gate it
 * would put a per-span subscriber and a doomed command dispatch into every
 * self-hosted deployment. Making it a required dep turns that mistake into a
 * type error.
 */
export function createBillingMeterPokeSubscriber<
  E extends Event = Event,
>(deps: {
  /**
   * The billable event types on the pipeline this is mounted on. Each mount
   * declares its own, because the billable set is spread across several
   * pipelines and no single one of them sees all of it.
   */
  eventTypes: readonly string[];
  /** ADR-102 — the typed cross-pipeline port into billing-reporting. */
  reportUsageForMonth: (data: ReportUsageForMonthCommandData) => Promise<void>;
  /** Usage reporting is SaaS-only; off everywhere else. */
  isSaas: boolean;
  resolveOrganizationId?: (projectId: string) => Promise<string | null>;
  now?: () => number;
}): EventSubscriberDefinition<E> {
  const resolveOrganizationId =
    deps.resolveOrganizationId ?? resolveOrganizationIdFromProject;
  const now = deps.now ?? Date.now;

  return {
    name: "billingMeterPoke",
    eventTypes: deps.eventTypes,
    options: {
      disabled: !deps.isSaas,
      killSwitch: { customKey: BILLING_METER_POKE_KILL_SWITCH_KEY },
      deduplication: {
        makeId: billingMeterPokeDedupId,
        ttlMs: POKE_DEDUP_TTL_MS,
      },
    },
    handle: async (event) => {
      const projectId = String(event.tenantId);
      const organizationId = await resolveOrganizationId(projectId);

      if (!organizationId) {
        logger.warn(
          { projectId },
          "orphan project detected, has no organization -- skipping billing poke",
        );
        return;
      }

      const at = new Date(now());
      const billingMonths: string[] = [];
      // Grace window: while late-arriving events can still land in the previous
      // month, poke for it too, so they reach the invoice they belong to.
      if (at.getUTCDate() <= BILLING_GRACE_PERIOD_DAYS) {
        billingMonths.push(getPreviousBillingMonth(at));
      }
      billingMonths.push(getBillingMonth(at));

      // Each month is attempted independently: a previous-month dispatch that
      // fails must not starve the current month, which is the one still
      // accumulating.
      const failures: Error[] = [];
      for (const billingMonth of billingMonths) {
        try {
          await deps.reportUsageForMonth({
            organizationId,
            billingMonth,
            tenantId: organizationId,
            occurredAt: now(),
          });
        } catch (error) {
          failures.push(
            error instanceof Error ? error : new Error(String(error)),
          );
          logger.error(
            {
              organizationId,
              billingMonth,
              error: error instanceof Error ? error.message : String(error),
            },
            "failed to dispatch usage reporting command — the billable events are recorded but nothing has reported them to the meter",
          );
        }
      }

      // Raised, not swallowed. The predecessor logged a warning and returned,
      // which made the job SUCCEED: the queue never retried, no failure series
      // moved, and the only trace of an unreported month was a warn line
      // nobody alerts on. Throwing retries the job, moves
      // `es_subscriber_total{subscriber_name="billingMeterPoke",status="failed"}`,
      // and leaves the sweep to close whatever the retries still lose.
      const [firstFailure] = failures;
      if (firstFailure) {
        throw firstFailure;
      }
    },
  };
}
