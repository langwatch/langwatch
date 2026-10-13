/**
 * The plan comparison, at `/settings/plans`. ONE READ AND ONE TABLE: which
 * plan the organization is on, and what each other would give them. No
 * chrome — the settings frame is applied by whichever app serves the address.
 */

import { Skeleton } from "@langwatch/design-system/primitives";

import { billingApi } from "../../behavior/billing-api.ts";
import { useBillingPricingService } from "../../behavior/use-billing-pricing-service.ts";
import { useBillingHost } from "../../model/billing-host.ts";
import { PlansComparisonPage } from "./plans-comparison.tsx";

export default function PlansScreen() {
  const organization = useBillingHost().organization();
  const pricing = useBillingPricingService();
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
    return <Skeleton width="full" height="200px" />;
  }

  return (
    <PlansComparisonPage
      activePlan={activePlan.data}
      pricingModel={organization?.pricingModel ?? void 0}
      growthSeatPriceCents={pricing.getGrowthSeatPriceCents()}
    />
  );
}
