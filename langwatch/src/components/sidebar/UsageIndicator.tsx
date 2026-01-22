import { Box, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";

const MENU_ITEM_HEIGHT = "32px";

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

  if (!usage.data || !isSaaS) {
    return null;
  }

  const percentage = Math.min(
    (usage.data.currentMonthMessagesCount /
      usage.data.activePlan.maxMessagesPerMonth) *
      100,
    100,
  );

  return (
    <Tooltip
      content={`You have used ${usage.data.currentMonthMessagesCount.toLocaleString()} traces out of ${usage.data.activePlan.maxMessagesPerMonth.toLocaleString()} this month.`}
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
                value={usage.data.currentMonthMessagesCount}
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
