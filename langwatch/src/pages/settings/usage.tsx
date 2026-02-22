import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
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

function ResourceLimitsCard({
  planLabel,
  planColorPalette,
  subtitle,
  limits,
  showLimits,
  actionHref,
  actionLabel,
}: {
  planLabel: string;
  planColorPalette: string;
  subtitle: string;
  limits: React.ComponentProps<typeof ResourceLimitsDisplay>["limits"];
  showLimits?: boolean;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <Card.Root borderWidth={1} borderColor="gray.200">
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5}>
          <Flex justifyContent="space-between" alignItems="flex-start">
            <VStack align="start" gap={1}>
              <HStack gap={3}>
                <Text fontWeight="semibold" fontSize="lg">
                  Resource Usage
                </Text>
                <Badge
                  colorPalette={planColorPalette}
                  variant="outline"
                  borderRadius="md"
                  paddingX={2}
                  paddingY={0.5}
                  fontSize="xs"
                >
                  {planLabel}
                </Badge>
              </HStack>
              <Text color="gray.500" fontSize="sm">
                {subtitle}
              </Text>
            </VStack>
            <Button asChild variant="ghost" size="sm" color="gray.600">
              <Link href={actionHref}>
                {actionLabel} <ArrowRight size={14} />
              </Link>
            </Button>
          </Flex>
          <ResourceLimitsDisplay limits={limits} showLimits={showLimits} />
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function Usage() {
  const { organization } = useOrganizationTeamProject();
  const { period, setPeriod } = usePeriodSelector(30);

  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;
  const { url: planManagementUrl, buttonLabel: planButtonLabel } =
    usePlanManagementUrl();

  const organizationId = organization?.id ?? "";
  const queryOpts = { enabled: !!organization, refetchOnWindowFocus: false, refetchOnMount: false } as const;

  const activePlan = api.plan.getActivePlan.useQuery({ organizationId }, queryOpts);
  const usage = api.limits.getUsage.useQuery({ organizationId }, queryOpts);
  const licenseStatus = api.license.getStatus.useQuery(
    { organizationId },
    { ...queryOpts, enabled: !!organization && !isSaaS },
  );

  const isSelfHosted = !isSaaS;
  const isLoadingLimits =
    isSelfHosted &&
    (licenseStatus.isLoading || usage.isLoading) &&
    !licenseStatus.data &&
    !usage.data;
  const hasLimitsError =
    isSelfHosted && (licenseStatus.isError || usage.isError);
  const hasCorruptedLicense =
    isSelfHosted &&
    licenseStatus.data?.hasLicense &&
    "corrupted" in licenseStatus.data &&
    licenseStatus.data.corrupted;
  const hasValidLicense =
    isSelfHosted &&
    licenseStatus.data?.hasLicense &&
    "plan" in licenseStatus.data;
  const isFreeTier =
    isSelfHosted &&
    licenseStatus.data &&
    !licenseStatus.data.hasLicense &&
    usage.data;

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="stretch" maxWidth="900px" marginX="auto">
        <Flex justifyContent="space-between" alignItems="flex-start">
          <VStack align="start" gap={1}>
            <Heading size="xl">Usage</Heading>
            <Text color="gray.500" fontSize="sm">
              Monitor your resource consumption and plan limits
            </Text>
          </VStack>
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </Flex>

        {/* SaaS: Resource limits from active plan */}
        {usage.data && isSaaS && (
          <ResourceLimitsCard
            planLabel={activePlan.data?.free ? "Free" : (activePlan.data?.name ?? "Plan")}
            planColorPalette={activePlan.data?.free ? "gray" : "blue"}
            subtitle={`Current usage versus ${activePlan.data?.free ? "free tier" : "your plan"} limits`}
            limits={mapUsageToLimits(usage.data, usage.data.activePlan)}
            showLimits={activePlan.data?.free}
            actionHref={planManagementUrl}
            actionLabel={planButtonLabel}
          />
        )}

        {/* Self-hosted: Loading state */}
        {isLoadingLimits && (
          <Card.Root borderWidth={1} borderColor="gray.200">
            <Card.Body paddingY={5} paddingX={6}>
              <VStack align="start" gap={4}>
                <Text fontWeight="semibold" fontSize="lg">Resource Limits</Text>
                <Skeleton height="20px" width="200px" />
                <Skeleton height="80px" width="full" />
              </VStack>
            </Card.Body>
          </Card.Root>
        )}

        {/* Self-hosted: Error state */}
        {hasLimitsError && (
          <Card.Root borderWidth={1} borderColor="red.200" backgroundColor="red.50">
            <Card.Body paddingY={5} paddingX={6}>
              <Text color="red.600" fontSize="sm">
                Unable to load resource limits. Please refresh the page or
                contact support if the issue persists.
              </Text>
            </Card.Body>
          </Card.Root>
        )}

        {/* Self-hosted: Corrupted license */}
        {hasCorruptedLicense && (
          <Card.Root borderWidth={1} borderColor="orange.200" backgroundColor="orange.50">
            <Card.Body paddingY={5} paddingX={6}>
              <VStack align="start" gap={2}>
                <Text fontWeight="semibold" fontSize="lg">Resource Limits</Text>
                <Text color="orange.700" fontSize="sm">
                  Your license appears to be corrupted. Please re-upload your
                  license on the{" "}
                  <Link href="/settings/license" textDecoration="underline" fontWeight="semibold">
                    License page
                  </Link>
                  .
                </Text>
              </VStack>
            </Card.Body>
          </Card.Root>
        )}

        {/* Self-hosted: Valid license */}
        {hasValidLicense &&
          licenseStatus.data &&
          "currentMembers" in licenseStatus.data && (
            <ResourceLimitsCard
              planLabel="Licensed"
              planColorPalette="green"
              subtitle="Current resource usage"
              limits={mapLicenseStatusToLimits(licenseStatus.data)}
              actionHref={planManagementUrl}
              actionLabel={planButtonLabel}
            />
          )}

        {/* Self-hosted: Free tier */}
        {isFreeTier && (
          <ResourceLimitsCard
            planLabel="Free"
            planColorPalette="gray"
            subtitle="Current usage versus free tier limits"
            limits={mapUsageToLimits(usage.data, FREE_PLAN)}
            showLimits
            actionHref="/settings/license"
            actionLabel="Manage license"
          />
        )}
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("cost:view", {
  layoutComponent: SettingsLayout,
})(Usage);
