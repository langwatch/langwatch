import { Alert, Text } from "@langwatch/design-system/primitives";
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
    <Alert.Root status="warning" width="full" data-testid="seat-limit-banner">
      <Alert.Indicator />
      <Alert.Content>
        {isEnterprisePlan ? (
          <Text>
            {message}{" "}
            <NavigationLink
              href={CONTACT_SALES_URL}
              isExternal
              textDecoration="underline"
              _hover={{ textDecoration: "none" }}
            >
              Contact sales
            </NavigationLink>{" "}
            to add seats.
          </Text>
        ) : (
          <Text>
            {message}{" "}
            <NavigationLink
              href={planManagementHref}
              textDecoration="underline"
              _hover={{ textDecoration: "none" }}
            >
              Upgrade your plan
            </NavigationLink>{" "}
            to keep everyone.
          </Text>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}
