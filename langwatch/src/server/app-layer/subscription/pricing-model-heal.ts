import { createLogger } from "../../../utils/logger/server";
import { TtlCache } from "../../utils/ttlCache";

const logger = createLogger("langwatch:billing:pricingModelHeal");

const HEAL_GUARD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Write-once guard: at most one drift check (and heal) per organization per
 * window, atomic across pods via Redis SET NX (ADR-039 Decision 3). Prevents
 * write amplification against read-replica lag and multi-pod races.
 */
export const pricingModelHealGuard = new TtlCache<true>(
  HEAL_GUARD_TTL_MS,
  "ttlcache:billing:pricingModelHeal:",
);

export type PricingModelSelfHeal = (params: {
  organizationId: string;
  plan?: {
    planSource: "license" | "subscription" | "free";
    type: string;
    free: boolean;
  };
}) => Promise<void>;

/**
 * Lazily converges the Organization.pricingModel display cache with the
 * organization's actual seat-event billing (ADR-039 Decision 3). No decision
 * reads the column after rollout step 1 — this keeps backoffice display and
 * analytics from contradicting how the organization is billed.
 *
 * Fire-and-forget from the resolver: failures are logged, never thrown.
 */
export function createPricingModelSelfHeal({
  hasActiveSeatEventSubscription,
  getPricingModel,
  setPricingModel,
  invalidateMeterDecision,
  notifyLicenseSubscriptionConflict,
  guard = pricingModelHealGuard,
}: {
  hasActiveSeatEventSubscription: (organizationId: string) => Promise<boolean>;
  getPricingModel: (organizationId: string) => Promise<string | null>;
  setPricingModel: (params: {
    organizationId: string;
    pricingModel: "SEAT_EVENT";
  }) => Promise<void>;
  invalidateMeterDecision: (organizationId: string) => Promise<void>;
  notifyLicenseSubscriptionConflict?: (params: {
    organizationId: string;
    licensePlanType: string;
  }) => Promise<void>;
  guard?: TtlCache<true>;
}): PricingModelSelfHeal {
  return async ({ organizationId, plan }) => {
    try {
      const claimed = await guard.claim(organizationId, true);
      if (!claimed) {
        return;
      }

      const isSeatEvent = await hasActiveSeatEventSubscription(organizationId);
      if (!isSeatEvent) {
        return;
      }

      // ADR-039 Decision 11: a license winning the rank while a paid
      // seat-event subscription runs is a billing conflict a human must
      // resolve. Alert only — never cancel or mutate the subscription.
      if (plan?.planSource === "license" && !plan.free) {
        await notifyLicenseSubscriptionConflict?.({
          organizationId,
          licensePlanType: plan.type,
        });
      }

      const pricingModel = await getPricingModel(organizationId);
      if (pricingModel === "SEAT_EVENT") {
        return;
      }

      await setPricingModel({ organizationId, pricingModel: "SEAT_EVENT" });
      await invalidateMeterDecision(organizationId);

      logger.info(
        { organizationId, previousPricingModel: pricingModel },
        "healed drifted pricingModel to SEAT_EVENT",
      );
    } catch (error) {
      logger.error(
        { organizationId, error },
        "pricingModel self-heal failed (non-fatal)",
      );
    }
  };
}
