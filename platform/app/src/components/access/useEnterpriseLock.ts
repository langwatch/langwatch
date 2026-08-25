import { useActivePlan } from "~/hooks/useActivePlan";
import { usePublicEnv } from "~/hooks/usePublicEnv";

/**
 * Whether this organization's plan carries a control, and the words to say
 * when it does not.
 *
 * Two states rather than one, because an organization can hold a control
 * without holding the plan — it turned the control on and then moved off
 * Enterprise. Whatever it turned on is still in force, and the administrator
 * has to be able to turn it OFF, or a lapsed plan would be a state they
 * cannot undo. So the plan gates turning something ON and nothing else.
 *
 * The way out differs by deployment: a Cloud customer buys a plan, an
 * operator activates a license, and a "See plans" link on a self-hosted
 * installation leads to a page they cannot buy from.
 *
 * The two-step requirement card grew this shape first and still carries its
 * own copy of it. This is the same reasoning made reusable for the controls
 * that came after; folding that card onto this hook is a tidy-up for the day
 * somebody touches its internals for another reason.
 */
export function useEnterpriseLock({
  /** Whether the control is currently on, plan or no plan. */
  held,
  /** What to say when the plan does not carry it and it is off. */
  offExplanation,
  /** What to say when the plan does not carry it and it is already on. */
  heldExplanation,
}: {
  held: boolean;
  offExplanation: string;
  heldExplanation: string;
}): {
  /** Whether turning the control on is available on this plan. */
  canTurnOn: boolean;
  /** The plan is not carrying it, and we know that for certain. */
  locked: boolean;
  /** The control is inert AND there is a reason worth saying on it. */
  explained: boolean;
  explanation: string;
  linkLabel: string;
  linkHref: string;
} {
  const { isEnterprise, isLoading } = useActivePlan();
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS ?? false;
  // Until the plan is known nothing is marked as locked: a badge that appears
  // and then vanishes for an Enterprise organization tells them something
  // untrue about what they bought.
  const locked = !isEnterprise && !isLoading;

  return {
    canTurnOn: isEnterprise,
    locked,
    explained: locked,
    explanation: held ? heldExplanation : offExplanation,
    linkLabel: isSaaS ? "See plans" : "Activate a license",
    linkHref: isSaaS ? "/settings/subscription" : "/settings/license",
  };
}
