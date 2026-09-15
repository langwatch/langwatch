import { Badge, Box, Heading, HStack, Spacer, VStack } from "@chakra-ui/react";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";
import { GovernanceHero, HOME_MEASURE } from "../../../features/overview/ui/sections/governance-hero.tsx";
import { GovernanceHeroGround } from "../../../features/overview/ui/sections/governance-hero-ground.tsx";
import { GovernanceHomeSections } from "../../../features/overview/ui/sections/governance-home-sections.tsx";
import { QuarantineFillAlert } from "../../../features/overview/ui/sections/quarantine-fill-panel.tsx";
import { SampleDataToggle } from "../../../ui/elements/sample-data-controls.tsx";
import { useSampleMode } from "../../../ui/elements/governance-sample-mode.ts";
import { useGovernanceHost } from "../../../model/governance-host.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";

/**
 * The overview: a greeting, the inline palette, the ways in, and the two
 * lists that fill once there is something in them. Reads nothing itself —
 * former activity-monitor panels now live on the pages that own them.
 * Ported from `.../pages/governance/index.tsx` (main); guards drop, this
 * branch guards at the route.
 */
function GovernanceOverviewPage() {
  const host = useGovernanceHost();
  const { organization, hasAnyPermission } = useGovernanceScope();
  const orgId = organization?.id ?? "";

  // The one grant the overview asks about: the vendor pill opens an add flow
  // the inventory refuses without it.
  const canManageSources = hasAnyPermission("ingestionSources:manage");

  const sample = useSampleMode();

  // The Insights screen rides the billed-cost flag, the same way the section
  // rail decides whether to list it. Offering the button without the flag
  // would point at a page the guard refuses.
  const canSetUpInsights = host.isFeatureEnabled("release_ui_governance_billed_cost_enabled");

  return (
    <GovernanceLayout pageTitle="AI Governance · LangWatch">
      <VStack align="stretch" gap={8} width="full" maxW={HOME_MEASURE} marginX="auto">
        {/* The only place this page still says its own name; the sample
            toggle sits at its right like every other governance page. */}
        <VStack align="stretch" gap={6}>
          {/* Stacked above the ground: the hero's light bleeds past its own
              box, and would otherwise sit under the row's words. */}
          <HStack gap={2} align="center" position="relative" zIndex={1}>
            <Heading size="sm">AI Governance</Heading>
            <Badge colorPalette="purple" variant="subtle">
              Preview
            </Badge>
            <Spacer />
            <SampleDataToggle active={sample.active} onToggle={sample.toggle} size="sm" />
          </HStack>

          {orgId && !sample.active && <QuarantineFillAlert organizationId={orgId} />}

          <GovernanceHeroGround>
            <Box paddingTop={{ base: 2, md: 4 }}>
              <GovernanceHero canManageSources={canManageSources} />
            </Box>
          </GovernanceHeroGround>
        </VStack>

        <GovernanceHomeSections canSetUpInsights={canSetUpInsights} sample={sample.active} />
      </VStack>
    </GovernanceLayout>
  );
}

export default GovernanceOverviewPage;
