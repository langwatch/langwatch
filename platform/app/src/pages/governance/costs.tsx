import {
  Alert,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";

import type { GovernanceCostSummaryDto } from "@ee/governance/services/governanceCost.service";

import {
  CostLanePanel,
  SeatLanePanel,
} from "~/components/governance/CostLanePanel";
import { CostLanesChart } from "~/components/governance/CostLanesChart";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const WINDOW_DAYS = 30;

/**
 * The cost screen: three lanes, side by side, each labeled for what it is.
 *
 * The lanes are never added together. What a provider invoices and what the
 * gateway metered are two different measurements of overlapping traffic, and
 * the gap between them is the thing worth looking at — a combined figure would
 * hide exactly what the screen exists to show.
 *
 * Nothing here ever renders a zero it did not measure. A failed read, a
 * deployment without a cost store, and a lane with no figure all render as
 * such; `$0.00` is reserved for a lane that really did report no spend.
 *
 * Spec: specs/governance/governance-cost-screen.feature (ADR-128)
 */
function CostsPage() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const organizationId = organization?.id ?? "";

  const summary = api.governanceCost.summary.useQuery(
    { organizationId, windowDays: WINDOW_DAYS },
    { enabled: !!organizationId },
  );

  return (
    <GovernanceLayout pageTitle="Costs · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full">
        <VStack align="start" gap={1}>
          <Heading size="md">Costs</Heading>
          <Text color="fg.muted">
            What your providers billed and what the gateway metered, side by
            side. They measure different things, so they are shown separately
            and never added together.
          </Text>
        </VStack>

        <CostsBody
          isLoading={summary.isLoading && !!organizationId}
          isError={summary.isError}
          data={summary.data}
        />
      </VStack>
    </GovernanceLayout>
  );
}

/**
 * The body's four states, kept in one place so no branch can quietly acquire a
 * zero: loading, failed read, unavailable, and figures.
 */
function CostsBody({
  isLoading,
  isError,
  data,
}: {
  isLoading: boolean;
  isError: boolean;
  data: GovernanceCostSummaryDto | undefined;
}) {
  if (isLoading) {
    return (
      <VStack align="stretch" gap={4} data-testid="cost-lanes-loading">
        <Skeleton height="120px" />
        <Skeleton height="260px" />
      </VStack>
    );
  }

  // A failed read is an outage, not an empty account. Rendering the lanes with
  // zeros here would state that nothing was spent, which we do not know.
  if (isError || !data) {
    return (
      <Alert.Root status="error" data-testid="cost-lanes-error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Cost data could not be loaded</Alert.Title>
          <Alert.Description>
            Something went wrong reading your cost figures. Try again in a
            moment. Nothing is shown rather than a total we cannot stand behind.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  if (data.unavailableReason !== null) {
    return (
      <Alert.Root status="info" data-testid="cost-lanes-unavailable">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Cost data is unavailable</Alert.Title>
          <Alert.Description>
            {data.unavailableReason === "no_cost_store"
              ? "This deployment does not have cost storage configured, so no cost has been recorded."
              : "No cost has been recorded for this organization yet."}
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return (
    <VStack align="stretch" gap={6}>
      <HStack align="stretch" gap={4} flexWrap="wrap">
        <CostLanePanel
          testId="cost-lane-billed"
          label="Billed by provider"
          description="What your providers report they will invoice."
          amountUsd={data.billed.amountUsd}
          cellsWithoutAmount={data.billed.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.billed.currenciesWithoutUsdAmount}
        />
        <CostLanePanel
          testId="cost-lane-gateway"
          label="Metered by gateway"
          description="What the gateway measured as it served your traffic."
          amountUsd={data.gateway.amountUsd}
          cellsWithoutAmount={data.gateway.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.gateway.currenciesWithoutUsdAmount}
        />
        <SeatLanePanel testId="cost-lane-seats" seats={data.seats} />
      </HStack>
      <CostLanesChart series={data.series} />
    </VStack>
  );
}

// Composed on top of the section-wide governance flag, never instead of it:
// flipping the section flag off still hides this page. The permission is
// `governanceCost:view` rather than `governance:view` — reading what the
// organization spends is its own capability, delegable without handing over
// the ingestion and anomaly admin surfaces.
export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withFeatureFlagGuard("release_ui_governance_billed_cost_enabled", {
    bypassOnboardingRedirect: true,
  })(
    withPermissionGuard("governanceCost:view", {
      bypassOnboardingRedirect: true,
    })(CostsPage),
  ),
);
