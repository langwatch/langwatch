import {
  Badge,
  Button,
  Heading,
  HStack,
  Progress,
  Skeleton,
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
import {
  ResourceLimitsDisplay,
  mapLicenseStatusToLimits,
  mapUsageToLimits,
} from "../../components/license/ResourceLimitsDisplay";
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
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  const _aggregatedCosts = api.costs.getAggregatedCostsForOrganization.useQuery(
    {
      organizationId: organization?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
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
    {
      enabled: !!organization && !isSaaS,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
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
          {!isSaaS && (licenseStatus.isLoading || usage.isLoading) && !licenseStatus.data && !usage.data && (
            <>
              <Heading size="md" as="h2">
                Resource Limits
              </Heading>
              <Skeleton height="20px" width="200px" />
              <Skeleton height="100px" width="full" maxWidth="400px" />
            </>
          )}
          {!isSaaS && (licenseStatus.isError || usage.isError) && (
            <Text color="fg.muted">
              Unable to load resource limits. Please refresh the page or contact support if the issue persists.
            </Text>
          )}
          {!isSaaS && licenseStatus.data?.hasLicense && "corrupted" in licenseStatus.data && licenseStatus.data.corrupted && (
            <>
              <Heading size="md" as="h2">
                Resource Limits
              </Heading>
              <Text color="orange.500">
                Your license appears to be corrupted. Please re-upload your license on the{" "}
                <Link href="/settings/license" textDecoration="underline">
                  License page
                </Link>
                .
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
              <ResourceLimitsDisplay
                limits={mapLicenseStatusToLimits(licenseStatus.data)}
              />
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
              <ResourceLimitsDisplay
                limits={mapUsageToLimits(usage.data, FREE_PLAN)}
              />
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
