import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";

import { NavigationLink } from "../elements/navigation-link.tsx";

/**
 * Shown on every page while the organization uses more seats than its plan or license
 * includes (specs/licensing/subscription-page.feature, enterprise-lock.feature). A self-hosted
 * install manages its license; Cloud Enterprise contacts sales; other plans compare plans.
 */
export function SeatLimitBanner({
  message,
  isEnterprisePlan,
  isSaaS,
  planManagementHref,
}: {
  message: string;
  isEnterprisePlan: boolean;
  isSaaS: boolean;
  planManagementHref: string;
}) {
  if (!isSaaS) {
    return (
      <Banner
        status="warning"
        placement="top"
        title="Your organization has more members than your license includes"
        data-testid="seat-limit-banner"
        action={
          <BannerAction asChild>
            <NavigationLink href={planManagementHref}>Manage license</NavigationLink>
          </BannerAction>
        }
      >
        Add seats to your license to keep everyone.
      </Banner>
    );
  }
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
            <NavigationLink href={planManagementHref}>Compare plans</NavigationLink>
          )}
        </BannerAction>
      }
    >
      {isEnterprisePlan ? "Contact sales to add seats." : "Upgrade your plan to keep everyone."}
    </Banner>
  );
}
