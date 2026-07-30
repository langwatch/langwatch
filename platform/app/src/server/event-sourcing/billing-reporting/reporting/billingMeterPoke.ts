import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "@ee/billing/services/billableEventsQuery";
import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { resolveOrganizationId as resolveOrganizationIdDefault } from "~/server/organizations/resolveOrganizationId";
import {
  BILLING_GRACE_PERIOD_DAYS,
  BILLING_METER_POKE_KILL_SWITCH_KEY,
  POKE_DEDUP_TTL_MS,
} from "../constants";
import type { ReportUsageForMonthData } from "./reportUsageForMonth";

const logger = createLogger("langwatch:billing-reporting:meter-poke");

/** The minimal shape the poke needs from an event: which project it happened in. */
export interface BillableEventForPoke {
  readonly tenantId: string;
}

export interface BillingMeterPokeDeps {
  readonly resolveOrganizationId: (
    projectId: string,
  ) => Promise<string | undefined>;
  /** ADR-102 — the typed cross-pipeline port into this pipeline's own command. */
  readonly dispatchReport: (data: ReportUsageForMonthData) => Promise<void>;
  readonly now?: () => number;
}

/** One lane per project, so a project ingesting continuously mints one job per
 *  window rather than one per event. */
export function billingMeterPokeGroupKey(
  event: BillableEventForPoke,
): GroupKey {
  return {
    tenantId: event.tenantId,
    lane: { kind: "subscriber", name: "billingMeterPoke" },
    scope: { kind: "partition", parts: [event.tenantId] },
  };
}

/** The dedup key. Exported so a mount can assert what it is collapsing on. */
export function billingMeterPokeDedupId(event: BillableEventForPoke): string {
  return renderGroupKey(billingMeterPokeGroupKey(event));
}

/**
 * The billing poke: a billable event happened here, so re-read the
 * organization's month total and report it. A trigger, not the guarantee —
 * that is `billingMeterSweep.ts` — which is what lets this side stay losable.
 *
 * Three collapses stack, and they are why a per-event handler is affordable:
 * the mount's dedup keys on the project for five minutes; the dispatch dedups
 * again on `[organizationId, billingMonth]`; and the report reads the total as
 * a LEVEL, so one poke is worth as much as ten and a lost one costs nothing.
 */
export async function handleBillableEventPoke(
  event: BillableEventForPoke,
  deps: BillingMeterPokeDeps,
): Promise<void> {
  const resolveOrganizationId = deps.resolveOrganizationId;
  const now = deps.now ?? Date.now;

  const projectId = event.tenantId;
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
      await deps.dispatchReport({
        organizationId,
        billingMonth,
        tenantId: organizationId,
        occurredAt: now(),
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.push(failure);
      logger.error(
        { organizationId, billingMonth, error: failure.message },
        "failed to dispatch usage reporting command -- the billable events are recorded but nothing has reported them to the meter",
      );
    }
  }

  // Raised, not swallowed: a failure logged-and-returned would make this
  // job's queue treat the delivery as successful, so nothing would retry it
  // and the only trace of an unreported month would be a warn line nobody
  // alerts on.
  const [firstFailure] = failures;
  if (firstFailure) {
    throw firstFailure;
  }
}

/**
 * How the poke is mounted. `eventTypes` is supplied per call site because the
 * billable set spans 4 pipelines and no single one sees all of it.
 *
 * `disabled` is derived from `isSaas` rather than left to the caller: usage
 * reporting exists only in the SaaS build, and a mount that forgot to gate it
 * would put a per-event handler and a doomed dispatch into every self-hosted
 * deployment.
 */
export interface BillingMeterPokeMount {
  readonly name: "billingMeterPoke";
  readonly eventTypes: readonly string[];
  readonly disabled: boolean;
  readonly killSwitchKey: typeof BILLING_METER_POKE_KILL_SWITCH_KEY;
  readonly deduplication: {
    readonly makeId: typeof billingMeterPokeDedupId;
    readonly ttlMs: number;
  };
  readonly handle: (event: BillableEventForPoke) => Promise<void>;
}

export function createBillingMeterPokeMount(deps: {
  readonly eventTypes: readonly string[];
  readonly isSaas: boolean;
  readonly dispatchReport: BillingMeterPokeDeps["dispatchReport"];
  readonly resolveOrganizationId?: BillingMeterPokeDeps["resolveOrganizationId"];
  readonly now?: () => number;
}): BillingMeterPokeMount {
  const resolveOrganizationId =
    deps.resolveOrganizationId ?? resolveOrganizationIdDefault;

  return {
    name: "billingMeterPoke",
    eventTypes: deps.eventTypes,
    disabled: !deps.isSaas,
    killSwitchKey: BILLING_METER_POKE_KILL_SWITCH_KEY,
    deduplication: {
      makeId: billingMeterPokeDedupId,
      ttlMs: POKE_DEDUP_TTL_MS,
    },
    handle: (event) =>
      handleBillableEventPoke(event, {
        resolveOrganizationId,
        dispatchReport: deps.dispatchReport,
        now: deps.now,
      }),
  };
}
