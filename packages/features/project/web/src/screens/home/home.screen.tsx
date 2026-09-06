import { Box, Container, chakra, Grid, HStack, Skeleton, Spacer, VStack } from "@chakra-ui/react";
import { LuCalendarClock } from "react-icons/lu";
// The page's serif display voice (Sentient) is declared in langy-theme.css.
// Imported HERE, not just via Langy components, so the greeting, banner, and
// recents headings render the real face on every home — including the one
// where no Langy surface mounts.
import "@langwatch/langy-web/surfaces/langy-theme.css";
import {
  BriefingMockSwitcher,
  HomeBriefingSection,
  SetupHairline,
} from "../../screens/home/briefing/index.ts";
import { homeApi } from "../../behavior/home-api.ts";
import { DocsGuides } from "./components/docs-guides.tsx";
import { HomeStateSwitcher } from "./components/dev/home-state-switcher.tsx";
import { chartVariantFor, useHomeDevState } from "./components/dev/home-dev-state.ts";
import { HomeFortune } from "./components/home-fortune.tsx";
import { HomePageBanners } from "./components/home-page-banners.tsx";
import { LangyHomeHero } from "./components/langy-home-hero.tsx";
import { LearningResources } from "./components/learning-resources.tsx";
import { OnboardingProgress } from "./components/onboarding-progress.tsx";
import { RecentItemsSection } from "./components/recent-items-section.tsx";
import { TracesOverview } from "./components/traces-overview.tsx";
import { useHomeComposition } from "./components/use-home-composition.ts";
import { useProjectReach } from "./components/use-project-reach.ts";
import { WelcomeHeader } from "./components/welcome-header.tsx";
import { useProjectHomeHost } from "../../model/project-home-host.ts";

/**
 * The application shell is not this page's — chrome layout draws it. A
 * briefing for the returning user, not a lobby. Three compositions resolve
 * in strict order (SIGNAL-FOCUSED, LANGY, CLASSIC); signal-focused wins outright.
 */
export function HomePage() {
  const composition = useHomeComposition();

  return (
    <>
      {/* `clip`, not `hidden`. The lit block's bloom bleeds sideways past its
          own box on purpose, and on a viewport narrower than the container
          that bleed landed outside the page and gave the home a horizontal
          scrollbar. `overflow: hidden` is what cannot be used here — it makes
          this a scroll container and forces the cross axis to `auto`, which is
          what broke the page scroll before. `overflow-x: clip` clips the one
          axis without creating a scroll container, so the block still bleeds
          DOWN into the page and nothing scrolls sideways. */}
      <Box width="full" position="relative" overflowX="clip">
        {/* A reading measure, not a dashboard sprawl: the briefing sheet is
            the page, so the column narrows to keep its lines composed. */}
        <Container maxW="7xl" padding={5} position="relative" zIndex={1}>
          <VStack gap={4} width="full" align="start">
            {/* Positioned above the hero's bleed on purpose: the lantern's
                ground (and its light-mode bloom) are positioned layers that
                would otherwise paint over this static row. The page's order
                is colour, then bloom, then every element on top. */}
            <HStack width="full" align="center" gap={2} position="relative" zIndex={2}>
              {/* The Langy home greets from the centre of its own hero, where
                  the question is being asked. Rendering the greeting here as
                  well would put it on the page twice. */}
              {composition === "langy" ? null : <WelcomeHeader />}
              <Spacer />
              {/* The one sales-y ask: the friendly line, small and quiet, with
                  the demo link as a compact pill beside it. Shown to people who
                  might still buy, and to nobody else.

                  The line and the pill go together or not at all: the pill is
                  the ask and the line is what sets it up, so hiding one would
                  leave a bare "Request a demo" with nothing explaining it. */}
              <ConsideringLangWatch />
            </HStack>

            {composition === "undecided" ? (
              <HomeCompositionSkeleton />
            ) : composition === "signal-focused" ? (
              <>
                <HomeBriefingSection />
                {/* The chrome grid: two equal-height columns whose interior
                    splits OFFSET — the first card in each column sits at its
                    natural height (they differ), and the second grows to fill
                    the rest, so the middle seam staggers instead of running
                    straight across. Content can always take more; nothing is
                    ever squeezed into overlap. */}
                <Grid
                  templateColumns={{ base: "1fr", lg: "1fr 1fr" }}
                  gap={4}
                  width="full"
                  alignItems="stretch"
                >
                  <VStack gap={4} align="stretch" minWidth={0}>
                    <HomePageBanners />
                    <Box flex="1" display="flex" minHeight="120px">
                      <DocsGuides />
                    </Box>
                  </VStack>
                  <VStack gap={4} align="stretch" minWidth={0}>
                    <SetupHairline />
                    <Box flex="1" display="flex" minHeight="100px">
                      <HomeFortune />
                    </Box>
                  </VStack>
                </Grid>
                <RecentItemsSection />
              </>
            ) : composition === "langy" ? (
              <LangyHome />
            ) : (
              <>
                <HomePageBanners variant="legacy" />
                <TracesOverview />
                <RecentItemsSection />
                <OnboardingProgress />
              </>
            )}

            {/* Dev-only chrome (the briefing mock switcher and the Langy
                home's state switcher) belongs with the footer links, not next
                to the greeting. */}
            <LearningResources
              trailing={
                <HStack gap={2}>
                  <BriefingMockSwitcher />
                  <HomeStateSwitcher />
                </HStack>
              }
            />
          </VStack>
        </Container>
      </Box>
    </>
  );
}

/**
 * The home page's one sales-y ask, spared for anyone not KNOWN to be on
 * the free plan — while resolving, unknown hides it, since a false
 * positive reads as the product forgetting who a paying customer is.
 */
function ConsideringLangWatch() {
  const organization = useProjectHomeHost().organization();
  const activePlan = homeApi.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  if (activePlan.data?.free !== true) return null;

  return (
    <HStack gap={2.5} align="center">
      <chakra.span
        fontSize="12px"
        color="fg.subtle"
        whiteSpace="nowrap"
        display={{ base: "none", md: "inline" }}
      >
        Considering LangWatch for your team?
      </chakra.span>
      <chakra.a
        href="https://langwatch.ai/get-a-demo"
        target="_blank"
        rel="noreferrer"
        display="inline-flex"
        alignItems="center"
        gap={1.5}
        fontFamily="mono"
        fontSize="11.5px"
        whiteSpace="nowrap"
        color="fg.muted"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="full"
        paddingX={2.5}
        paddingY="4px"
        transition="color 130ms ease, border-color 130ms ease"
        _hover={{
          color: "orange.fg",
          borderColor: "orange.emphasized",
        }}
      >
        <LuCalendarClock size={12} />
        Request a demo
      </chakra.a>
    </HStack>
  );
}

/**
 * What the page shows before it knows which home it is. Flags used to
 * resolve to classic, paint it, then swap, so the home visibly changed
 * shape on cold load. This commits to nothing: just the shape all three share.
 */
function HomeCompositionSkeleton() {
  return (
    <VStack gap={4} width="full" align="stretch" aria-busy="true" aria-label="Loading your home">
      <Skeleton height="180px" borderRadius="xl" />
      <Skeleton height="96px" borderRadius="lg" />
      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={4}>
        <Skeleton height="120px" borderRadius="lg" />
        <Skeleton height="120px" borderRadius="lg" />
      </Grid>
    </VStack>
  );
}

/**
 * The Langy home's spine: lit block leads, page continues as before. The
 * setup checklist moves — on a no-data project it takes the figures' place
 * under the block, since there's nothing to show yet. Spec: specs/home/langy-home.feature
 */
function LangyHome() {
  const { isNewProject } = useProjectReach();
  const devState = useHomeDevState();
  const empty = devState === "empty" ? true : devState === "populated" ? false : isNewProject;

  return (
    <>
      <HomePageBanners variant="lantern">
        <LangyHomeHero />
      </HomePageBanners>
      {empty ? (
        <OnboardingProgress />
      ) : (
        <>
          <TracesOverview variant={chartVariantFor(devState)} />
          <RecentItemsSection />
          <OnboardingProgress />
        </>
      )}
      {/* The route into the docs. It is not the footer's quiet link list
          (LearningResources renders below for every composition): this is the
          guided one, and a home that has just invited someone to ask a
          question in plain language is exactly where the reader who would
          rather read the docs first needs to find them.

          Its onboarding control is off here because that control moved UP into
          the lit block, where the attention is. Two of the same on one page
          would just be one of them going unclicked. */}
      <DocsGuides />
    </>
  );
}

/**
 * The default export the page loader resolves. `HomePage` stays named for
 * the suite that has always driven it by name.
 */
export default HomePage;
