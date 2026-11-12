/**
 * Organization usage at /settings/usage: on hosted, the plan strip, the month's events day by
 * day and by type, each project's share and the seats; self-hosted keeps its licence tiles
 * above the month.
 * @see specs/licensing/usage-page.feature
 */

import { Link } from "@langwatch/browser-host/link";
import { Banner } from "@langwatch/design-system/banner";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { StatTile, StatTileFigure, StatTileSkeleton } from "@langwatch/design-system/stat-tile";
import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import type { UsageMonthBreakdown } from "@langwatch/entitlement-contract";
import { ArrowRight } from "lucide-react";

import { billingApi, type UsageRead } from "../../behavior/billing-api.ts";
import { useBillingPricingService } from "../../behavior/use-billing-pricing-service.ts";
import { useBillingHost } from "../../model/billing-host.ts";
import { parseGrowthSeatPlanType, type Currency } from "../../model/billing-plans.ts";
import { SUBSCRIPTION_PATH } from "../../model/checkout-intent.ts";
import {
  getPlanActionLabel,
  planActionHref,
  planManagementUrl,
} from "../../model/plan-management-url.ts";
import { PricingModel } from "../../model/prisma-types.ts";
import {
  breakdownGapMessage,
  chartAxis,
  dailyBars,
  fullSeats,
  liteRow,
  monthEvents,
  planStrip,
  shortDate,
  type UsagePagePlan,
} from "../../model/usage-page-state.ts";
import { UsageEventsCard, type UsageEventsCardState } from "../blocks/usage-events-card.tsx";
import { UsagePlanStrip } from "../blocks/usage-plan-strip.tsx";
import { UsageProjectsCard } from "../blocks/usage-projects-card.tsx";
import { UsageSeatsCard } from "../blocks/usage-seats-card.tsx";
import { UsageTypesCard } from "../blocks/usage-types-card.tsx";
import {
  mapLicenseStatusToLimits,
  mapUsageToLimits,
  RESOURCE_LABELS,
  ResourceLimitsDisplay,
} from "./resource-limits/resource-limits-display.tsx";
import { SaasPageOpened } from "./saas-page-opened.tsx";
import { useSubscriptionCurrency } from "./use-subscription-currency.ts";

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
  showLiteMembers,
  messagesLabel,
}: {
  planLabel: string;
  chipLabel: string;
  limits: React.ComponentProps<typeof ResourceLimitsDisplay>["limits"];
  showLiteMembers?: boolean;
  messagesLabel?: string;
}) {
  return (
    <ResourceLimitsDisplay
      limits={limits}
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

type ReadState = { isLoading: boolean; isError: boolean; data?: unknown };

/** Whether the limits are still being read, or failed, for this deployment. */
function limitsReadState({
  isSaaS,
  usage,
  licenseStatus,
}: {
  isSaaS: boolean | undefined;
  usage: ReadState;
  licenseStatus: ReadState;
}) {
  if (isSaaS === undefined) return { isLoadingLimits: true, hasLimitsError: false };
  if (isSaaS) {
    return { isLoadingLimits: usage.isLoading && !usage.data, hasLimitsError: usage.isError };
  }
  return {
    isLoadingLimits:
      (licenseStatus.isLoading || usage.isLoading) && !licenseStatus.data && !usage.data,
    hasLimitsError: licenseStatus.isError || usage.isError,
  };
}

/** The events card from the month's count, the plan and the daily breakdown. */
function eventsCardState({
  usage,
  breakdown,
  plan,
  pricingModel,
  currency,
}: {
  usage: { data?: UsageRead; isLoading: boolean; isError: boolean };
  breakdown: UsageMonthBreakdown | undefined;
  plan: UsagePagePlan | undefined;
  pricingModel: PricingModel | null | undefined;
  currency: Currency;
}): UsageEventsCardState {
  if (usage.isError) return { kind: "unavailable" };
  if (!usage.data || !plan) return { kind: "loading" };
  const count = usage.data.currentMonthMessagesCount;
  if (count === null) return { kind: "unavailable" };
  const events = monthEvents({ count, plan, pricingModel, currency });
  if (count === 0) {
    return { kind: "empty", cap: events.allowance?.kind === "cap" ? events.allowance.max : null };
  }
  const days = breakdown?.days;
  const chart = days
    ? {
        bars: dailyBars({ days, unit: "events" }),
        axis: chartAxis(days),
        summary: `Events per day this month, from ${chartAxis(days)[0] ?? ""}.`,
      }
    : null;
  return { kind: "month", events, chart };
}

/** The plan strip, events, projects and seats a hosted organization reads. */
function HostedUsage({
  organizationId,
  pricingModel,
  plan,
  usage,
}: {
  organizationId: string;
  pricingModel: PricingModel | null | undefined;
  plan: UsagePagePlan | undefined;
  usage: { data?: UsageRead; isLoading: boolean; isError: boolean };
}) {
  const host = useBillingHost();
  const { currency: detectedCurrency } = useSubscriptionCurrency(organizationId);
  const seatPrices = useBillingPricingService().getGrowthSeatPriceCents();
  const breakdown = billingApi.limits.getMonthBreakdown.useQuery(
    { organizationId },
    { enabled: !!organizationId && host.canReadMonthBreakdown(), refetchOnWindowFocus: false },
  );
  const growth = plan ? parseGrowthSeatPlanType(plan.type) : null;
  const currency = growth?.currency ?? detectedCurrency;
  const seatPriceCents = growth ? seatPrices[growth.currency][growth.billingInterval] : 0;
  const projects = breakdown.data?.projects ?? [];
  const byCategory = breakdown.data?.byCategory ?? null;
  // When the count itself is unknown the events card already says so.
  const isCountKnown = usage.data !== undefined && usage.data.currentMonthMessagesCount !== null;
  const breakdownGap = isCountKnown
    ? breakdownGapMessage({
        isError: breakdown.isError,
        isDailyUnavailable: breakdown.data?.isDailyUnavailable === true,
        isByCategoryUnavailable: breakdown.data?.isByCategoryUnavailable === true,
        isProjectsUnavailable: breakdown.data?.projects === null,
      })
    : null;

  return (
    <>
      {plan && (
        <UsagePlanStrip
          strip={planStrip({ plan, currency, seatPriceCents })}
          actionHref={planActionHref({
            isSaaS: true,
            isFree: plan.free,
            isEnterprise: plan.type === PlanTypes.ENTERPRISE,
          })}
        />
      )}
      <UsageEventsCard
        unit={usage.data?.usageUnit === "traces" ? "traces" : "events"}
        state={eventsCardState({ usage, breakdown: breakdown.data, plan, pricingModel, currency })}
        resetsOn={breakdown.data ? `Resets on ${shortDate(breakdown.data.resetsOn)}` : undefined}
      />
      {breakdownGap && (
        <Banner status="warning" data-testid="usage-breakdown-unavailable">
          {breakdownGap}
        </Banner>
      )}
      {byCategory && usage.data?.currentMonthMessagesCount !== 0 && (
        <UsageTypesCard byCategory={byCategory} />
      )}
      {projects.length > 0 && usage.data?.currentMonthMessagesCount !== 0 && (
        <UsageProjectsCard projects={projects} />
      )}
      {plan && usage.data && (
        <UsageSeatsCard
          fullSeats={fullSeats({ used: usage.data.membersCount, plan })}
          lite={liteRow({
            plan,
            pricingModel,
            liteCount: usage.data.membersLiteCount,
          })}
        />
      )}
    </>
  );
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
  const { isLoadingLimits, hasLimitsError } = limitsReadState({ isSaaS, usage, licenseStatus });
  const hasValidLicense =
    isSelfHosted && licenseStatus.data?.hasLicense && "plan" in licenseStatus.data;
  const isUnlicensed =
    isSelfHosted && licenseStatus.data && !licenseStatus.data.hasLicense && usage.data;

  const saasPlan = activePlan.data ?? usage.data?.activePlan;
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
  const actionHref = hasValidLicense ? planManagementHref : "/settings/license";
  const selfHostedActionLabel = hasValidLicense ? licensedActionLabel : unlicensedActionLabel;

  return (
    <>
      <SaasPageOpened page="settings_usage" />
      <PageLayout.Header>
        <PageLayout.Heading>Usage</PageLayout.Heading>
        <Spacer />
        {isSaaS === true && (
          <PageLayout.HeaderButton asChild>
            <Link unstyled href={SUBSCRIPTION_PATH} data-testid="usage-plan-billing-link">
              <HStack as="span" gap={1}>
                Plan & billing <ArrowRight size={14} aria-hidden />
              </HStack>
            </Link>
          </PageLayout.HeaderButton>
        )}
        {isSaaS === false && actionFor({ href: actionHref, label: selfHostedActionLabel })}
      </PageLayout.Header>
      <VStack gap={4} width="full" align="stretch" paddingTop={4}>
        <Text color="fg.muted">
          What this organization used this month, against what its plan includes.
        </Text>

        {isSaaS && (
          <HostedUsage
            organizationId={organizationId}
            pricingModel={organization?.pricingModel}
            plan={saasPlan}
            usage={usage}
          />
        )}

        {isLoadingLimits && !isSaaS && <StatTileSkeleton columns={showLiteMembers ? 4 : 3} />}

        {hasLimitsError && !isSaaS && (
          <Banner status="error">
            Unable to load resource limits. Please refresh the page or contact support if the issue
            persists.
          </Banner>
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
            limits={mapUsageToLimits(usage.data)}
            showLiteMembers={showLiteMembers}
            messagesLabel={messagesLabel}
          />
        )}
      </VStack>
    </>
  );
}
