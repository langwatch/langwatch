/**
 * Who is offered the organization's own Instant Evals switch: a self-serve
 * organization agrees to sending judged text itself, while an enterprise plan
 * negotiates it and a self-hosted install judges under its Connect licence.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import { isEnterpriseTier } from "@langwatch/entitlement-contract";
import type { InstantEvalOptInOffer } from "@langwatch/instant-eval-contract";

/** The organization's half of the offer: the hosted service, and not an enterprise plan. */
export function isOptInSwitchOffered({
  isSaas,
  planType,
}: {
  isSaas: boolean;
  planType: string;
}): boolean {
  return isSaas && !isEnterpriseTier(planType);
}

/**
 * The offer to one member: the switch only to a member who may throw it, so
 * the popover never shows a button the server would refuse.
 */
export function optInOfferFor({
  switchOffered,
  maySwitch,
}: {
  switchOffered: boolean;
  maySwitch: boolean;
}): InstantEvalOptInOffer {
  if (!switchOffered) return "contact_us";
  return maySwitch ? "enable" : "ask_admin";
}
