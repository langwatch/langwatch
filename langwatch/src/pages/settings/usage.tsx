import {
  Button,
  Heading,
  HStack,
  Progress,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function Usage() {
  const { organization } = useOrganizationTeamProject();
  const { period, setPeriod } = usePeriodSelector(30);

  const activePlan = api.plan.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization,
    },
  );

  const aggregatedCosts = api.costs.getAggregatedCostsForOrganization.useQuery(
    {
      organizationId: organization?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    {},
  );

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
          <Heading as="h2">Usage</Heading>
          <Spacer />
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </HStack>
        <VStack width="full" gap={4} align="start">
          {usage.data && isSaaS && (
            <>
              <Heading>Trace Usage</Heading>
              <Progress.Root
                defaultValue={0}
                max={usage.data?.activePlan.maxMessagesPerMonth}
                value={Math.min(
                  usage.data?.currentMonthMessagesCount,
                  usage.data?.activePlan.maxMessagesPerMonth,
                )}
                maxW="sm"
                colorPalette="orange"
                width="full"
              >
                <Progress.Label fontSize="xs"></Progress.Label>
                <Progress.Track flex="1">
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
              <Text>
                You have used{" "}
                <b>{usage.data?.currentMonthMessagesCount.toLocaleString()}</b>{" "}
                traces out of{" "}
                <b>
                  {usage.data?.activePlan.maxMessagesPerMonth.toLocaleString()}
                </b>{" "}
                traces this month.
              </Text>
              <Button asChild marginBottom={2}>
                <Link href="/settings/subscription">Change plan</Link>
              </Button>
            </>
          )}
          {activePlan.data && !activePlan.data.free && (
            <>
              <Heading size="md" as="h2">
                Active Plan
              </Heading>
              <Text paddingBottom={4}>
                You are on the <b>{activePlan.data.name}</b> plan
              </Text>
            </>
          )}
        </VStack>
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("cost:view", {
  layoutComponent: SettingsLayout,
})(Usage);
