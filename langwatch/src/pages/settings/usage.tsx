import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Progress,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { usePlanManagementUrl } from "~/hooks/usePlanManagementUrl";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { ResourceLimitRow } from "../../components/license/ResourceLimitRow";
import { FREE_PLAN } from "../../../ee/licensing/constants";

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

  const _aggregatedCosts = api.costs.getAggregatedCostsForOrganization.useQuery(
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
  const { url: planManagementUrl, buttonLabel: planButtonLabel } = usePlanManagementUrl();

  const licenseStatus = api.license.getStatus.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization && !isSaaS }
  );

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
                <Link href={planManagementUrl}>{planButtonLabel}</Link>
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
          {!isSaaS && licenseStatus.data?.hasLicense && "plan" in licenseStatus.data && (
            <>
              <Heading size="md" as="h2">
                Resource Limits
              </Heading>
              <Text color="fg.muted" fontSize="sm" marginBottom={2}>
                Current usage versus your license limits
              </Text>
              <Box
                borderWidth="1px"
                borderRadius="lg"
                padding={6}
                width="full"
                maxWidth="md"
              >
                <VStack align="start" gap={2}>
                  <ResourceLimitRow
                    label="Members"
                    current={licenseStatus.data.currentMembers}
                    max={licenseStatus.data.maxMembers}
                  />
                  <ResourceLimitRow
                    label="Projects"
                    current={licenseStatus.data.currentProjects}
                    max={licenseStatus.data.maxProjects}
                  />
                  <ResourceLimitRow
                    label="Prompts"
                    current={licenseStatus.data.currentPrompts}
                    max={licenseStatus.data.maxPrompts}
                  />
                  <ResourceLimitRow
                    label="Workflows"
                    current={licenseStatus.data.currentWorkflows}
                    max={licenseStatus.data.maxWorkflows}
                  />
                  <ResourceLimitRow
                    label="Scenarios"
                    current={licenseStatus.data.currentScenarios}
                    max={licenseStatus.data.maxScenarios}
                  />
                  <ResourceLimitRow
                    label="Evaluators"
                    current={licenseStatus.data.currentEvaluators}
                    max={licenseStatus.data.maxEvaluators}
                  />
                </VStack>
              </Box>
              <Button asChild marginTop={2}>
                <Link href={planManagementUrl}>{planButtonLabel}</Link>
              </Button>
            </>
          )}
          {!isSaaS && licenseStatus.data && !licenseStatus.data.hasLicense && usage.data && (
            <>
              <HStack gap={3}>
                <Heading size="md" as="h2">
                  Resource Limits
                </Heading>
                <Badge
                  colorPalette="gray"
                  fontSize="sm"
                  paddingX={2}
                  paddingY={1}
                >
                  Free
                </Badge>
              </HStack>
              <Text color="fg.muted" fontSize="sm" marginBottom={2}>
                Current usage versus free tier limits
              </Text>
              <Box
                borderWidth="1px"
                borderRadius="lg"
                padding={6}
                width="full"
                maxWidth="md"
              >
                <VStack align="start" gap={2}>
                  <ResourceLimitRow
                    label="Members"
                    current={1}
                    max={FREE_PLAN.maxMembers}
                  />
                  <ResourceLimitRow
                    label="Projects"
                    current={usage.data.projectsCount}
                    max={FREE_PLAN.maxProjects}
                  />
                  <ResourceLimitRow
                    label="Prompts"
                    current={0}
                    max={FREE_PLAN.maxPrompts ?? 3}
                  />
                  <ResourceLimitRow
                    label="Workflows"
                    current={0}
                    max={FREE_PLAN.maxWorkflows}
                  />
                  <ResourceLimitRow
                    label="Scenarios"
                    current={0}
                    max={FREE_PLAN.maxScenarios ?? 3}
                  />
                  <ResourceLimitRow
                    label="Evaluators"
                    current={0}
                    max={FREE_PLAN.maxEvaluators ?? 3}
                  />
                  <ResourceLimitRow
                    label="Messages/Month"
                    current={usage.data.currentMonthMessagesCount}
                    max={FREE_PLAN.maxMessagesPerMonth}
                  />
                  <ResourceLimitRow
                    label="Evaluations Credit"
                    current={0}
                    max={FREE_PLAN.evaluationsCredit}
                  />
                </VStack>
              </Box>
              <Button asChild marginTop={2}>
                <Link href="/settings/license">Manage license</Link>
              </Button>
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
