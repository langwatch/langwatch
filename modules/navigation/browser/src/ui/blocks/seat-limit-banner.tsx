import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";

import { NavigationLink } from "../elements/navigation-link.tsx";

/**
 * Shown on every page while the organization uses more seats than its plan
 * includes (specs/licensing/subscription-page.feature). Enterprise contacts
 * sales; every other plan is linked to its plan management page.
 */
export function SeatLimitBanner({
  message,
  isEnterprisePlan,
  planManagementHref,
}: {
  message: string;
  isEnterprisePlan: boolean;
  planManagementHref: string;
}) {
  return (
    <Banner
      status="warning"
      placement="top"
      title={message}
      data-testid="seat-limit-banner"
      action={
        <BannerAction asChild>
          {isEnterprisePlan ? (
            <NavigationLink href={CONTACT_SALES_URL} isExternal>
              Contact sales
            </NavigationLink>
          ) : (
            <NavigationLink href={planManagementHref}>Upgrade your plan</NavigationLink>
          )}
        </BannerAction>
      }
    >
      {isEnterprisePlan ? "Contact sales to add seats." : "Upgrade your plan to keep everyone."}
    </Banner>
  );
}
