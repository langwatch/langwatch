/**
 * The plan comparison, at `/settings/plans`.
 *
 * ONE READ AND ONE TABLE: which plan the organization is on, and what each of
 * the others would give them. The screen carries no chrome — the settings frame
 * is applied by whichever application serves the address.
 */

import { Spinner } from "@chakra-ui/react";
import { billingApi } from "../../behavior/billing-api";
import { useBillingHost } from "../../model/billing-host";
import { PlansComparisonPage } from "./plans-comparison";

/** The grant the platform page asked for, unchanged. */
export const PLANS_PAGE_PERMISSION = "organization:view";

export default function PlansScreen() {
  const organization = useBillingHost().organization();
  const activePlan = billingApi.plan.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization?.id,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  if (activePlan.isLoading && !activePlan.data) {
    return <Spinner />;
  }

  return (
    <PlansComparisonPage
      activePlan={activePlan.data}
      pricingModel={organization?.pricingModel ?? void 0}
    />
  );
}
