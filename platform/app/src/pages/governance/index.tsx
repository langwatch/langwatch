import { Badge, Box, Heading, HStack, Spacer, VStack } from "@chakra-ui/react";
import {
  GovernanceHero,
  HOME_MEASURE,
} from "~/components/governance/GovernanceHero";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { GovernanceHeroGround } from "~/components/governance/home/GovernanceHeroGround";
import { GovernanceHomeSections } from "~/components/governance/home/GovernanceHomeSections";
import { QuarantineFillAlert } from "~/components/governance/QuarantineFillAlert";
import {
  SampleDataToggle,
  useSampleMode,
} from "~/components/governance/sample";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

/**
 * The governance overview: a greeting, the command palette mounted inline,
 * the ways in, and the two lists that will fill once there is something in
 * them.
 *
 * Everything sits in ONE centred column of `HOME_MEASURE` rather than running
 * out to the window: a full-bleed row under a centred field reads as two
 * pages stacked. The ask field itself is narrower than that column, centred
 * inside it, because it is the same field the project home opens with and is
 * set to the same width there (see `ASK_MEASURE` in `GovernanceHero`). The
 * column stays wider than the field for the two lists' sake, whose rows carry
 * a badge, a headline and a date across two grid columns.
 *
 * The hero stands on the same lit ground as the project home's ask field
 * (`GovernanceHeroGround`), because the two screens ask for the same thing in
 * the same words and only one of them was lit.
 *
 * It reads nothing of its own. The page used to carry every activity-monitor
 * panel — spend, users, anomalies, ingestion-source health, the CLI session
 * policy — each on its own router and its own grant, so a reader whose plan
 * or role did not include one of them met an error alert before they met the
 * page. Those panels live on the pages that own them (Costs, Inventory,
 * Agents, People), and the overview is now the way in rather than a second
 * copy of all four.
 *
 * Reading nothing is also why sample mode here is hard-coded `absent` rather
 * than settled from queries: there is no read on this page that could ever
 * come back holding a row, so the honest answer is that nothing is measured.
 * The toggle in the header is the section's one shared toggle — pressing it
 * here is the same press as pressing it on People — so it must be on this
 * page too, or the overview would be the one screen a reader could not turn
 * the samples off from.
 *
 * The one thing still drawn beside the hero is the quarantine-fill warning,
 * which is silent unless ingest is actually misconfigured
 * (specs/ai-gateway/governance/ingestion-attribution.feature).
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature,
 * specs/ai-governance/dashboard/governance-ui-controls.feature,
 * specs/ai-gateway/governance/governance-home-routing.feature,
 * specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
function GovernanceOverviewPage() {
  const { organization, project, hasAnyPermission } =
    useOrganizationTeamProject({ redirectToOnboarding: false });
  const orgId = organization?.id ?? "";

  // The one grant the overview asks about: the vendor pill opens an add flow
  // the inventory refuses without it.
  const canManageSources = hasAnyPermission("ingestionSources:manage");

  const sample = useSampleMode();

  // The Insights screen rides the billed-cost flag, the same way the section
  // rail decides whether to list it (`useVisibleSectionNavItems`). Offering
  // the button without the flag would point at a page the guard refuses.
  const insights = useFeatureFlag("release_ui_governance_billed_cost_enabled", {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    enabled: !!organization?.id,
  });

  return (
    <GovernanceLayout pageTitle="AI Governance · LangWatch">
      <VStack
        align="stretch"
        gap={8}
        width="full"
        maxW={HOME_MEASURE}
        marginX="auto"
      >
        {/* Small and to the side: the hero's greeting is the page's one big
            line, and the product shell stands the section rail down here, so
            this is the only place the page still says its own name. The
            sample toggle sits at the right of it, where every other
            governance page keeps its actions. */}
        <VStack align="stretch" gap={6}>
          {/* Stacked above the ground on purpose. The hero's light bleeds a
              long way past its own box — that is what makes it read as light
              rather than as a panel — and it reaches this row, whose words
              would otherwise sit under the bloom that keeps the middle of the
              ground clean. The project home stands its own chrome up the same
              way for the same reason. */}
          <HStack gap={2} align="center" position="relative" zIndex={1}>
            <Heading size="sm">AI Governance</Heading>
            <Badge colorPalette="purple" variant="subtle">
              Preview
            </Badge>
            <Spacer />
            <SampleDataToggle
              active={sample.active}
              onToggle={sample.toggle}
              size="sm"
            />
          </HStack>

          {orgId && !sample.active && (
            <QuarantineFillAlert organizationId={orgId} />
          )}

          <GovernanceHeroGround>
            <Box paddingTop={{ base: 2, md: 4 }}>
              <GovernanceHero canManageSources={canManageSources} />
            </Box>
          </GovernanceHeroGround>
        </VStack>

        <GovernanceHomeSections
          canSetUpInsights={insights.enabled}
          sample={sample.active}
        />
      </VStack>
    </GovernanceLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(GovernanceOverviewPage),
);
