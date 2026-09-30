import { Badge, Box, Spacer, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { GuidedOnboardingOffer } from "../../../behavior/lent-guided-onboarding-offer.tsx";
import { GovernanceHeroGround } from "../../../features/overview/ui/sections/governance-hero-ground.tsx";
import {
  GovernanceHero,
  HOME_MEASURE,
} from "../../../features/overview/ui/sections/governance-hero.tsx";
import { GovernanceHomeSections } from "../../../features/overview/ui/sections/governance-home-sections.tsx";
import { QuarantineFillAlert } from "../../../features/overview/ui/sections/quarantine-fill-panel.tsx";
import { useGovernanceHost } from "../../../model/governance-host.ts";
import { useSampleMode } from "../../../ui/elements/governance-sample-mode.ts";
import { SampleDataToggle } from "../../../ui/elements/sample-data-controls.tsx";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";
import { withGovernanceSection } from "../../../ui/sections/governance-section-gate.tsx";

/**
 * The overview: a greeting, the inline palette, the ways in, and the two
 * lists that fill once there is something in them. Reads only whether any
 * source is connected, for the guided offer; guards at the route, not the page.
 */
function GovernanceOverviewPage() {
  const host = useGovernanceHost();
  const { organization, hasAnyPermission } = useGovernanceScope();
  const orgId = organization?.id ?? "";

  // The one grant the overview asks about: the vendor pill opens an add flow
  // the inventory refuses without it.
  const canManageSources = hasAnyPermission("ingestionSources:manage");

  const sample = useSampleMode();

  // Governance is in use once any source is connected. A read the member may not make, or one
  // that failed, is unknown: the cache keeps the last list through a failed refetch.
  const canReadSources = hasAnyPermission("ingestionSources:view");
  const sources = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId && canReadSources, refetchOnWindowFocus: false },
  );
  const sourcesInUse =
    canReadSources && !sources.isError && sources.data ? sources.data.length > 0 : null;

  // The Insights screen rides the billed-cost flag, the same way the section
  // rail decides whether to list it. Offering the button without the flag
  // would point at a page the guard refuses.
  const canSetUpInsights = host.isFeatureEnabled("release_ui_governance_billed_cost_enabled");

  return (
    <GovernanceLayout pageTitle="AI Governance · LangWatch">
      <PageLayout.Header>
        <PageLayout.Heading>AI Governance</PageLayout.Heading>
        <Badge colorPalette="purple" size="sm" variant="surface">
          Preview
        </Badge>
        <Spacer />
        <SampleDataToggle active={sample.active} onToggle={sample.toggle} size="sm" />
      </PageLayout.Header>

      <PageLayout.Container>
        <VStack align="stretch" gap={8} width="full" maxW={HOME_MEASURE} marginX="auto">
          <VStack align="stretch" gap={6}>
            {orgId && !sample.active && <QuarantineFillAlert organizationId={orgId} />}

            <GovernanceHeroGround>
              <Box paddingTop={{ base: 2, md: 4 }}>
                <GovernanceHero canManageSources={canManageSources} />
              </Box>
            </GovernanceHeroGround>

            <GuidedOnboardingOffer space="governance" spaceInUse={sourcesInUse} />
          </VStack>

          <GovernanceHomeSections canSetUpInsights={canSetUpInsights} sample={sample.active} />
        </VStack>
      </PageLayout.Container>
    </GovernanceLayout>
  );
}

export default withGovernanceSection(GovernanceOverviewPage);
