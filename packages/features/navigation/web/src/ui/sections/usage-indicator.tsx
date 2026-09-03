/**
 * The usage meter at the foot of a navigation column.
 *
 * Moved from `platform/app/src/components/sidebar/UsageIndicator.tsx`. Three
 * seams changed and none of the rules did:
 *
 * - `api.limits.getUsage` is now this package's own procedure map, asked with
 *   the SAME path and input the application shell asks with, which under
 *   tRPC's path-plus-input cache key is one entry rather than two requests.
 * - `PricingModel.SEAT_EVENT` was a Prisma enum import; a governed web package
 *   may not import Prisma at all, so the one member the rule compares against
 *   is stated here as the string the wire already carries.
 * - `isSaaS` comes off the host's deployment reading rather than `usePublicEnv`.
 */

import { Box, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";
import { navigationApi } from "../../behavior/navigation-api";
import { useNavigationHost } from "../../model/navigation-host";
import { NavigationLink } from "../elements/navigation-link";

const MENU_ITEM_HEIGHT = "32px";

/**
 * The plan shape that has no per-message cap to draw a bar against.
 *
 * The wire carries the Prisma enum's own spelling; the enum itself belongs to
 * a package this one may not import.
 */
const SEAT_EVENT_PRICING = "SEAT_EVENT";

/**
 * Above this, a plan is unlimited and the bar has nothing to fill.
 *
 * `@langwatch/enterprise-billing-contract`'s `UNLIMITED_MESSAGES` in the module
 * this moved from — an enterprise contract a core web package should not take a
 * dependency on to read one sentinel.
 */
const UNLIMITED_MESSAGES = 999_999_999;

export type UsageDisplay = { visible: true; unitLabel: string } | { visible: false };

/**
 * Whether the sidebar usage bar is visible and which unit label to display.
 *
 * The unit label is read from the answer via `usageUnit` rather than derived
 * from the pricing model in the browser.
 *
 * Visibility rules:
 * - Self-hosted: always visible
 * - SaaS + seat-and-event pricing + paid: not visible
 * - All other SaaS: visible
 */
export function getUsageDisplay({
  isSaaS,
  pricingModel,
  isFree,
  usageUnit,
}: {
  isSaaS: boolean;
  pricingModel: string | undefined | null;
  isFree: boolean;
  usageUnit: string;
}): UsageDisplay {
  if (!isSaaS) {
    return { visible: true, unitLabel: usageUnit };
  }

  if (pricingModel === SEAT_EVENT_PRICING && !isFree) {
    return { visible: false };
  }

  return { visible: true, unitLabel: usageUnit };
}

export type UsageIndicatorProps = {
  showLabel?: boolean;
};

export const UsageIndicator = ({ showLabel = true }: UsageIndicatorProps) => {
  const host = useNavigationHost();
  const organization = host.organization();
  const isSaaS = host.deployment().isSaaS;

  const usage = navigationApi.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization && host.hasPermission("organization:view"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  if (!usage.data) {
    return null;
  }

  const display = getUsageDisplay({
    isSaaS,
    pricingModel: host.plan().pricingModel,
    isFree: usage.data.activePlan.free,
    usageUnit: usage.data.usageUnit ?? "events",
  });
  if (!display.visible) return null;

  // Unlimited plans have no cap to draw a progress bar against, so hide the
  // sidebar bar (the actual usage volume is still surfaced on /settings/usage).
  // currentMonthMessagesCount is null for legacy/unlimited responses; the
  // maxMessagesPerMonth check also covers metered plans that now return a real
  // count.
  const currentCount = usage.data.currentMonthMessagesCount;
  if (currentCount === null || usage.data.activePlan.maxMessagesPerMonth >= UNLIMITED_MESSAGES) {
    return null;
  }

  const percentage = Math.min(
    (currentCount / usage.data.activePlan.maxMessagesPerMonth) * 100,
    100,
  );

  return (
    <Tooltip
      content={`You have used ${currentCount.toLocaleString()} ${display.unitLabel} out of ${usage.data.activePlan.maxMessagesPerMonth.toLocaleString()} this month.`}
      positioning={{ placement: "right", offset: { mainAxis: 8 } }}
    >
      <NavigationLink href="/settings/usage" width={showLabel ? "full" : "auto"}>
        <HStack
          width={showLabel ? "full" : "auto"}
          height={showLabel ? "auto" : MENU_ITEM_HEIGHT}
          gap={3}
          paddingX={3}
          paddingTop={showLabel ? 2 : 0}
          paddingBottom={showLabel ? 1 : 0}
          borderRadius="lg"
          cursor="pointer"
          _hover={{
            backgroundColor: "nav.bgHover",
          }}
        >
          {showLabel ? (
            <VStack width="full" gap={1} align="start">
              <HStack width="full" justifyContent="space-between">
                <HStack gap={1}>
                  <Text fontSize="12px" color="nav.fgMuted">
                    Usage
                  </Text>
                  <Info size={12} color="var(--chakra-colors-fg-muted)" />
                </HStack>
                <Text fontSize="12px" color="fg.muted">
                  {Math.round(percentage)}%
                </Text>
              </HStack>
              <Progress.Root
                value={Math.min(currentCount, usage.data.activePlan.maxMessagesPerMonth)}
                max={usage.data.activePlan.maxMessagesPerMonth}
                colorPalette="orange"
                width="full"
                size="xs"
              >
                <Progress.Track borderRadius="full" backgroundColor="bg.muted" height="8px">
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </VStack>
          ) : (
            <Box
              flexShrink={0}
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="16px"
              height="16px"
            >
              <Info size={16} color="var(--chakra-colors-fg-muted)" />
            </Box>
          )}
        </HStack>
      </NavigationLink>
    </Tooltip>
  );
};
