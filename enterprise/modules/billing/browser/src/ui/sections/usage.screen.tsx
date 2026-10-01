/**
 * Organization usage at /settings/usage. One row of tiles per deployment shape
 * (hosted plan / self-hosted license / open-source). No chrome.
 */

import { Link } from "@langwatch/browser-host/link";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert, Text, VStack } from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { StatTile, StatTileFigure, StatTileSkeleton } from "@langwatch/design-system/stat-tile";
import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";

import { billingApi } from "../../behavior/billing-api.ts";
import { useBillingHost } from "../../model/billing-host.ts";
import {
  getPlanActionLabel,
  planManagementUrl,
  shouldShowPlanLimits,
} from "../../model/plan-management-url.ts";
import { PricingModel } from "../../model/prisma-types.ts";
import {
  mapLicenseStatusToLimits,
  mapUsageToLimits,
  RESOURCE_LABELS,
  ResourceLimitsDisplay,
} from "./resource-limits/resource-limits-display.tsx";

/** The plan the limits belong to, as the first tile of the row. */
function PlanTile({ planLabel, chipLabel }: { planLabel: string; chipLabel?: string }) {
  return (
    <StatTile label="Plan" data-testid="usage-plan">
      <StatTileFigure>{planLabel}</StatTileFigure>
      {chipLabel ? (
        <StatusChip label={chipLabel} tone={chipLabel === "Open source" ? "neutral" : "good"} />
      ) : null}
    </StatTile>
  );
}

function ResourceLimitsTiles({
  planLabel,
  chipLabel,
  limits,
  showLimits,
  showLiteMembers,
  messagesLabel,
}: {
  planLabel: string;
  chipLabel: string;
  limits: React.ComponentProps<typeof ResourceLimitsDisplay>["limits"];
  showLimits?: boolean;
  showLiteMembers?: boolean;
  messagesLabel?: string;
}) {
  return (
    <ResourceLimitsDisplay
      limits={limits}
      showLimits={showLimits}
      showLiteMembers={showLiteMembers}
      messagesLabel={messagesLabel}
      leading={<PlanTile planLabel={planLabel} chipLabel={chipLabel} />}
    />
  );
}

function messagesLabelFor({
  usageUnit,
  pricingModel,
}: {
  usageUnit: string | undefined;
  pricingModel: string | null | undefined;
}): string {
  if (usageUnit === "traces") return RESOURCE_LABELS.tracesPerMonth;
  if (usageUnit === "events") return RESOURCE_LABELS.eventsPerMonth;
  if (pricingModel === PricingModel.TIERED) return RESOURCE_LABELS.tracesPerMonth;
  return RESOURCE_LABELS.eventsPerMonth;
}

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
  const messagesLabel = messagesLabelFor({
    usageUnit: usage.data?.usageUnit,
    pricingModel: organization?.pricingModel,
  });
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

  const actionFor = ({ href, label }: { href: string; label: string }) => (
    <PageLayout.HeaderButton asChild>
      <Link unstyled href={href}>
        {label}
      </Link>
    </PageLayout.HeaderButton>
  );
  const actionHref = isSelfHosted && !hasValidLicense ? "/settings/license" : planManagementHref;
  const selfHostedActionLabel = hasValidLicense ? licensedActionLabel : unlicensedActionLabel;
  const actionLabel = isSelfHosted ? selfHostedActionLabel : saasActionLabel;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Usage</PageLayout.Heading>
        {isSaaS !== undefined && actionFor({ href: actionHref, label: actionLabel })}
      </PageLayout.Header>
      <VStack gap={6} width="full" align="stretch" paddingTop={4}>
        <Text color="fg.muted">How much this organization uses, against what its plan allows.</Text>

        {usage.data && isSaaS && (
          <ResourceLimitsTiles
            planLabel={saasPlan?.free ? "Free" : (saasPlan?.name ?? "Plan")}
            chipLabel="Current"
            limits={mapUsageToLimits(usage.data, saasPlan ?? usage.data.activePlan)}
            showLimits={showLimits}
            showLiteMembers={showLiteMembers}
            messagesLabel={messagesLabel}
          />
        )}

        {isLoadingLimits && <StatTileSkeleton columns={showLiteMembers ? 4 : 3} />}

        {hasLimitsError && (
          <Alert.Root status="error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                Unable to load resource limits. Please refresh the page or contact support if the
                issue persists.
              </Alert.Title>
            </Alert.Content>
          </Alert.Root>
        )}

        {hasValidLicense && licenseStatus.data && "currentMembers" in licenseStatus.data && (
          <ResourceLimitsTiles
            planLabel={"planName" in licenseStatus.data ? licenseStatus.data.planName : "Licensed"}
            chipLabel="Licensed"
            limits={mapLicenseStatusToLimits(licenseStatus.data)}
            showLiteMembers={showLiteMembers}
            messagesLabel={messagesLabel}
          />
        )}

        {isUnlicensed && (
          <ResourceLimitsTiles
            planLabel="Open source"
            chipLabel="Open source"
            limits={mapUsageToLimits(usage.data, UNLIMITED_PLAN)}
            showLiteMembers={showLiteMembers}
            messagesLabel={messagesLabel}
          />
        )}
      </VStack>
    </>
  );
}
