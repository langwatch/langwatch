import { Box, Container, chakra, Grid, HStack, Skeleton, Spacer, VStack } from "@chakra-ui/react";
import { useEffect } from "react";
import { LuCalendarClock } from "react-icons/lu";

// The page's serif display voice (Sentient) is declared in langy-theme.css.
// Imported HERE, not just via Langy components, so the greeting, banner, and
// recents headings render the real face on every home — including the one
// where no Langy surface mounts.
import { homeApi } from "../../../behavior/home-api.ts";
import { useProjectHomeHost } from "../../../model/project-home-host.ts";
import { safeReturnToPath } from "../../../model/project-switch.ts";
import { DocsGuides } from "./components/docs-guides.tsx";
import { HomePageBanners } from "./components/home-page-banners.tsx";
import { LangyHomeHero } from "./components/langy-home-hero.tsx";
import { LearningResources } from "./components/learning-resources.tsx";
import { OnboardingProgress } from "./components/onboarding-progress.tsx";
import { RecentItemsSection } from "./components/recent-items-section.tsx";
import { TracesOverview } from "./components/traces-overview.tsx";
import { useHomeComposition } from "./components/use-home-composition.ts";
import { useProjectReach } from "./components/use-project-reach.ts";
import { WelcomeHeader } from "./components/welcome-header.tsx";

/**
 * The application shell is not this page's — chrome layout draws it. Two
 * compositions: the Langy home for a reader with Langy, the classic home otherwise.
 */
export function HomePage() {
  const composition = useHomeComposition();

  return (
    <>
      {/* `clip`, not `hidden`. The lit block's bloom bleeds sideways past its box
          on purpose; on a narrow viewport that bleed caused a horizontal scrollbar.
          `overflow: hidden` forces the cross axis to `auto` too, breaking page scroll.
          `overflow-x: clip` clips just the one axis, so DOWN bleed still works. */}
      <Box width="full" position="relative" overflowX="clip">
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

            {composition === "undecided" && <HomeCompositionSkeleton />}
            {composition === "langy" && <LangyHome />}
            {composition === "classic" && (
              <>
                <HomePageBanners variant="legacy" />
                <TracesOverview />
                <RecentItemsSection />
                <OnboardingProgress />
              </>
            )}

            <LearningResources />
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
 * shape on cold load. This commits to nothing: just the shape both share.
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

  return (
    <>
      <HomePageBanners variant="lantern">
        <LangyHomeHero />
      </HomePageBanners>
      {isNewProject ? (
        <OnboardingProgress />
      ) : (
        <>
          <TracesOverview variant="strip" />
          <RecentItemsSection />
          <OnboardingProgress />
        </>
      )}
      {/* The route into the docs — not the footer's quiet link list (that renders
          below for every composition): this is the guided one, for a reader who'd
          rather read docs first than ask a question in plain language.
          Onboarding control is off here because it moved UP into the lit block —
          two of the same on one page would just leave one unclicked. */}
      <DocsGuides />
    </>
  );
}

/**
 * The home route the page loader resolves. A safe `return_to` from a project switch
 * lands back there once the scope has resolved (so the switch is remembered first),
 * as main's `HomePageWithReturnTo` did; nothing renders meanwhile.
 */
export function HomeScreen() {
  const host = useProjectHomeHost();
  const returnTo = safeReturnToPath(host.returnTo());
  const isReady = !host.isLoading();

  useEffect(() => {
    if (returnTo && isReady) host.navigate(returnTo);
  }, [host, returnTo, isReady]);

  return returnTo ? null : <HomePage />;
}

export default HomeScreen;
