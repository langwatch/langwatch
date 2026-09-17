import { useActivePlan } from "~/hooks/useActivePlan";
import { usePublicEnv } from "~/hooks/usePublicEnv";

/** Plan eligibility gates enabling a control. Existing controls can always be
 * disabled, and upgrade links depend on the deployment. */
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
