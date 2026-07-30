import { createLogger } from "@langwatch/observability";
import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "@ee/billing/services/billableEventsQuery";
import { resolveOrganizationId as resolveOrganizationIdDefault } from "~/server/organizations/resolveOrganizationId";
import { BILLING_GRACE_PERIOD_DAYS, BILLING_METER_POKE_KILL_SWITCH_KEY, POKE_DEDUP_TTL_MS } from "../constants";
import type { ReportUsageForMonthData } from "./reportUsageForMonth";

const logger = createLogger("langwatch:billing-reporting:meter-poke");

/** The minimal shape the poke needs from an event: which project it happened in. */
export interface BillableEventForPoke {
  readonly tenantId: string;
}

export interface BillingMeterPokeDeps {
  readonly resolveOrganizationId: (projectId: string) => Promise<string | undefined>;
  /** ADR-102 — the typed cross-pipeline port into this pipeline's own command. */
  readonly dispatchReport: (data: ReportUsageForMonthData) => Promise<void>;
  readonly now?: () => number;
}

/**
 * The poke's dispatch-plane identity (ADR-100): one lane per project, so a
 * project ingesting continuously mints one job per window rather than one
 * per event. `renderGroupKey` — never string concatenation — is what stops
 * this from drifting from the group-key format everywhere else in the system
 * uses; ADR-100 names exactly this drift ("the deduplication key for the same
 * job uses `:` where the group key uses `/`... two hand-written conventions
 * for the same identity") as a defect its descriptor exists to close.
 */
export function billingMeterPokeGroupKey(event: BillableEventForPoke): GroupKey {
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
 * The billing poke: a billable event happened somewhere in this project, so
 * re-read the organization's month total and report it.
 *
 * **This is a trigger, not the guarantee.** The guarantee is
 * `billingMeterSweep.ts`'s scheduled sweep, which re-reads and re-reports on
 * its own clock. That split is what lets this side stay cheap and fail loudly
 * instead of quietly.
 *
 * Three collapses stack, and they are the reason a per-event handler is
 * affordable here at all — only the first is enforced by this function
 * itself, the other two are a future dispatcher's job (see the module
 * docblock in `index.ts` for why none of them can be wired yet):
 *
 *   - A future mount's `deduplication` keys on the project and holds for five
 *     minutes (`POKE_DEDUP_TTL_MS`), so a project ingesting continuously
 *     mints ONE job per window rather than one per event.
 *   - `dispatchReport` (bound to `reportUsageForMonth`) dedups again on its
 *     own group key, scoped to `[organizationId, billingMonth]` — see
 *     `dispatchOptions.ts`'s `reportUsageForMonthGroupKey` — so the projects
 *     of one organization collapse onto one report.
 *   - That command reads the month total as a LEVEL rather than an
 *     increment, so a poke that lands is worth exactly as much as ten, and a
 *     poke that is lost costs nothing the next poke (or the sweep) does not
 *     recover.
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
    logger.warn({ projectId }, "orphan project detected, has no organization -- skipping billing poke");
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
 * Describes how the poke must be mounted, for a future subscriber-hosting
 * runtime — no such runtime exists in `@langwatch/event-sourcing` yet, so
 * this is a plain, documented descriptor rather than a call into a mount API.
 * `eventTypes` is supplied per call site because the billable set spans 4
 * pipelines and no single one of them sees all of it; each of their own
 * composition sites calls this with its own subset of
 * `../meter/billableEventsMeter.mapProjection`'s `BILLABLE_EVENT_TYPES`.
 *
 * `disabled` is derived from `isSaas` here, not left to the caller to
 * remember: usage reporting exists only in the SaaS build, and a mount that
 * forgot to gate it would put a per-event handler and a doomed dispatch into
 * every self-hosted deployment.
 */
export interface BillingMeterPokeMount {
  readonly name: "billingMeterPoke";
  readonly eventTypes: readonly string[];
  readonly disabled: boolean;
  readonly killSwitchKey: typeof BILLING_METER_POKE_KILL_SWITCH_KEY;
  readonly deduplication: { readonly makeId: typeof billingMeterPokeDedupId; readonly ttlMs: number };
  readonly handle: (event: BillableEventForPoke) => Promise<void>;
}

export function createBillingMeterPokeMount(deps: {
  readonly eventTypes: readonly string[];
  readonly isSaas: boolean;
  readonly dispatchReport: BillingMeterPokeDeps["dispatchReport"];
  readonly resolveOrganizationId?: BillingMeterPokeDeps["resolveOrganizationId"];
  readonly now?: () => number;
}): BillingMeterPokeMount {
  const resolveOrganizationId = deps.resolveOrganizationId ?? resolveOrganizationIdDefault;

  return {
    name: "billingMeterPoke",
    eventTypes: deps.eventTypes,
    disabled: !deps.isSaas,
    killSwitchKey: BILLING_METER_POKE_KILL_SWITCH_KEY,
    deduplication: { makeId: billingMeterPokeDedupId, ttlMs: POKE_DEDUP_TTL_MS },
    handle: (event) =>
      handleBillableEventPoke(event, {
        resolveOrganizationId,
        dispatchReport: deps.dispatchReport,
        now: deps.now,
      }),
  };
}
