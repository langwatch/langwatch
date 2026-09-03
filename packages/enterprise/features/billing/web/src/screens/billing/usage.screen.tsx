/**
 * What this organization has used, at `/settings/usage`.
 *
 * ONE CARD PER DEPLOYMENT SHAPE, and there are three: the hosted product reads
 * an active plan, a licensed self-hosted deployment reads its license, and an
 * unlicensed one reads the open-source baseline, which is uncapped.
 *
 * WHETHER LIMITS ARE SHOWN AT ALL is a billing question and not a display one:
 * usage-based pricing has no ceiling to draw, so printing one would be a
 * fiction. `shouldShowPlanLimits` holds that rule.
 *
 * The screen carries no chrome: the settings frame is applied by whichever
 * application serves the address.
 */

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
import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";
import {
  mapLicenseStatusToLimits,
  mapUsageToLimits,
  RESOURCE_LABELS,
  ResourceLimitsDisplay,
} from "@langwatch/enterprise-licensing-web";
import { ArrowRight } from "lucide-react";
import { billingApi } from "../../behavior/billing-api";
import { useBillingHost } from "../../model/billing-host";
import {
  getPlanActionLabel,
  planManagementUrl,
  shouldShowPlanLimits,
} from "../../model/plan-management-url";
import { PricingModel } from "../../model/prisma-types";
import { Link } from "../../ui/elements/link";

function ResourceLimitsCard({
  planLabel,
  planColorPalette,
  subtitle,
  limits,
  showLimits,
  showLiteMembers,
  actionHref,
  actionLabel,
  messagesLabel,
}: {
  planLabel: string;
  planColorPalette: string;
  subtitle: string;
  limits: React.ComponentProps<typeof ResourceLimitsDisplay>["limits"];
  showLimits?: boolean;
  showLiteMembers?: boolean;
  actionHref: string;
  actionLabel: string;
  messagesLabel?: string;
}) {
  return (
    <Card.Root borderWidth={1} borderColor="border">
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
              <Text color="fg.muted" fontSize="sm">
                {subtitle}
              </Text>
            </VStack>
            <Button asChild variant="ghost" size="sm" color="fg.muted">
              <Link href={actionHref}>
                {actionLabel} <ArrowRight size={14} />
              </Link>
            </Button>
          </Flex>
          <ResourceLimitsDisplay
            limits={limits}
            showLimits={showLimits}
            showLiteMembers={showLiteMembers}
            messagesLabel={messagesLabel}
          />
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** The grant the platform page asked for, unchanged. */
export const USAGE_PAGE_PERMISSION = "cost:view";

export default function UsageScreen() {
  const host = useBillingHost();
  const organization = host.organization();
  // The deployment is read as a settled pair: `isSaaS === false` selects the
  // self-hosted branch, which reads a LICENSE, and asking for one before the
  // deployment has answered fires a read the hosted product cannot serve.
  const isSaaS = host.isDeploymentSettled() ? host.isSaaS() : undefined;
  const planManagementHref = planManagementUrl(isSaaS === true);

  const organizationId = organization?.id ?? "";
  const queryOpts = {
    enabled: !!organization,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  } as const;

  const activePlan = billingApi.plan.getActivePlan.useQuery({ organizationId }, queryOpts);
  const usage = billingApi.limits.getUsage.useQuery({ organizationId }, queryOpts);
  const licenseStatus = billingApi.license.getStatus.useQuery(
    { organizationId },
    { ...queryOpts, enabled: !!organization && isSaaS === false },
  );
  const messagesLabel =
    usage.data?.usageUnit === "traces"
      ? RESOURCE_LABELS.tracesPerMonth
      : usage.data?.usageUnit === "events"
        ? RESOURCE_LABELS.eventsPerMonth
        : organization?.pricingModel === PricingModel.TIERED
          ? RESOURCE_LABELS.tracesPerMonth
          : RESOURCE_LABELS.eventsPerMonth;
  const showLiteMembers =
    organization?.pricingModel === PricingModel.SEAT_EVENT || isSaaS === false;

  const isSelfHosted = isSaaS === false;
  const isLoadingLimits =
    isSelfHosted &&
    (licenseStatus.isLoading || usage.isLoading) &&
    !licenseStatus.data &&
    !usage.data;
  const hasLimitsError = isSelfHosted && (licenseStatus.isError || usage.isError);
  const hasValidLicense =
    isSelfHosted && licenseStatus.data?.hasLicense && "plan" in licenseStatus.data;
  const isUnlicensed =
    isSelfHosted && licenseStatus.data && !licenseStatus.data.hasLicense && usage.data;

  const saasPlan = activePlan.data ?? usage.data?.activePlan;
  const showLimits = shouldShowPlanLimits({
    isFree: saasPlan?.free ?? true,
    isEnterprise: saasPlan?.type === PlanTypes.ENTERPRISE,
    pricingModel: organization?.pricingModel,
    planSource: saasPlan?.planSource,
  });
  const saasActionLabel = getPlanActionLabel({
    isSaaS: true,
    isFree: saasPlan?.free ?? true,
    isEnterprise: saasPlan?.type === PlanTypes.ENTERPRISE,
    hasValidLicense: false,
  });
  const licensedActionLabel = getPlanActionLabel({
    isSaaS: false,
    isFree: false,
    isEnterprise: false,
    hasValidLicense: true,
  });
  const unlicensedActionLabel = getPlanActionLabel({
    isSaaS: false,
    isFree: false,
    isEnterprise: false,
    hasValidLicense: false,
  });

  return (
    <VStack gap={6} width="full" align="stretch" maxWidth="900px" marginX="auto">
      <Flex justifyContent="space-between" alignItems="flex-start">
        <VStack align="start" gap={1}>
          <Heading size="xl">Usage</Heading>
          <Text color="fg.muted" fontSize="sm">
            Monitor your resource consumption and plan limits
          </Text>
        </VStack>
      </Flex>

      {/* SaaS: Resource limits from active plan */}
      {usage.data && isSaaS && (
        <ResourceLimitsCard
          planLabel={saasPlan?.free ? "Free" : (saasPlan?.name ?? "Plan")}
          planColorPalette={saasPlan?.free ? "gray" : "blue"}
          subtitle={`Current usage versus ${saasPlan?.free ? "free tier" : "your plan"} limits`}
          limits={mapUsageToLimits(usage.data, saasPlan ?? usage.data.activePlan)}
          showLimits={showLimits}
          showLiteMembers={showLiteMembers}
          actionHref={planManagementHref}
          actionLabel={saasActionLabel}
          messagesLabel={messagesLabel}
        />
      )}

      {/* Self-hosted: Loading state */}
      {isLoadingLimits && (
        <Card.Root borderWidth={1} borderColor="border">
          <Card.Body paddingY={5} paddingX={6}>
            <VStack align="start" gap={4}>
              <Text fontWeight="semibold" fontSize="lg">
                Resource Limits
              </Text>
              <Skeleton height="20px" width="200px" />
              <Skeleton height="80px" width="full" />
            </VStack>
          </Card.Body>
        </Card.Root>
      )}

      {/* Self-hosted: Error state */}
      {hasLimitsError && (
        <Card.Root
          borderWidth={1}
          colorPalette="red"
          borderColor="colorPalette.muted"
          bg="colorPalette.subtle"
        >
          <Card.Body paddingY={5} paddingX={6}>
            <Text color="colorPalette.fg" fontSize="sm">
              Unable to load resource limits. Please refresh the page or contact support if the
              issue persists.
            </Text>
          </Card.Body>
        </Card.Root>
      )}

      {/* Self-hosted: Valid license */}
      {hasValidLicense && licenseStatus.data && "currentMembers" in licenseStatus.data && (
        <ResourceLimitsCard
          planLabel="Licensed"
          planColorPalette="green"
          subtitle="Current resource usage"
          limits={mapLicenseStatusToLimits(licenseStatus.data)}
          showLiteMembers={showLiteMembers}
          actionHref={planManagementHref}
          actionLabel={licensedActionLabel}
          messagesLabel={messagesLabel}
        />
      )}

      {/* Self-hosted without a license: the Open Source baseline, uncapped */}
      {isUnlicensed && (
        <ResourceLimitsCard
          planLabel="Open Source"
          planColorPalette="gray"
          subtitle="Current usage on this deployment"
          limits={mapUsageToLimits(usage.data, UNLIMITED_PLAN)}
          showLiteMembers={showLiteMembers}
          actionHref="/settings/license"
          actionLabel={unlicensedActionLabel}
          messagesLabel={messagesLabel}
        />
      )}
    </VStack>
  );
}
