import { Box, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { PricingModel } from "@prisma/client";
import { Info } from "lucide-react";
import type { UsageUnit } from "../../server/app-layer/usage/usage-meter-policy";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";

const MENU_ITEM_HEIGHT = "32px";

export type UsageDisplay =
  | { visible: true; unitLabel: string }
  | { visible: false };

/**
 * Determines whether the sidebar usage bar is visible and which unit label
 * to display.
 *
 * The unit label is read directly from the API via `usageUnit` rather than
 * being derived from the pricing model on the frontend.
 *
 * Visibility rules:
 * - Self-hosted: always visible
 * - SaaS + SEAT_EVENT + paid: not visible
 * - All other SaaS: visible
 */
export function getUsageDisplay({
  isSaaS,
  pricingModel,
  isFree,
  usageUnit,
}: {
  isSaaS: boolean;
  pricingModel: PricingModel | undefined | null;
  isFree: boolean;
  usageUnit: UsageUnit;
}): UsageDisplay {
  if (!isSaaS) {
    return { visible: true, unitLabel: usageUnit };
  }

  if (pricingModel === PricingModel.SEAT_EVENT && !isFree) {
    return { visible: false };
  }

  return { visible: true, unitLabel: usageUnit };
}

export type UsageIndicatorProps = {
  showLabel?: boolean;
};

export const UsageIndicator = ({ showLabel = true }: UsageIndicatorProps) => {
  const { organization } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  if (!usage.data) {
    return null;
  }

  const display = getUsageDisplay({
    isSaaS: !!isSaaS,
    pricingModel: organization?.pricingModel,
    isFree: usage.data.activePlan.free,
    usageUnit: usage.data.usageUnit ?? "events",
  });
  if (!display.visible) return null;

  // When currentMonthMessagesCount is null (unlimited plan), don't show the usage bar
  const currentCount = usage.data.currentMonthMessagesCount;
  if (currentCount === null) return null;

  const percentage = Math.min(
    (currentCount /
      usage.data.activePlan.maxMessagesPerMonth) *
      100,
    100,
  );

  return (
    <Tooltip
      content={`You have used ${currentCount.toLocaleString()} ${display.unitLabel} out of ${usage.data.activePlan.maxMessagesPerMonth.toLocaleString()} this month.`}
      positioning={{ placement: "right", offset: { mainAxis: 8 } }}
    >
      <Link href="/settings/usage" width={showLabel ? "full" : "auto"}>
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
                <Progress.Track
                  borderRadius="full"
                  backgroundColor="bg.muted"
                  height="8px"
                >
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
      </Link>
    </Tooltip>
  );
};
