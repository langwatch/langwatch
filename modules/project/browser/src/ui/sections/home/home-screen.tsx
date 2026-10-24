import {
  Box,
  Container,
  chakra,
  Grid,
  HStack,
  Skeleton,
  Spacer,
  VStack,
} from "@langwatch/design-system/primitives";
import { UpgradeActionNeeded } from "@langwatch/ops-client";
import { PendingJoinRequests } from "@langwatch/organization-client/lent";
import { projectEntryPath, projectNavigation } from "@langwatch/project-contract";
import { useEffect } from "react";
import { LuCalendarClock } from "react-icons/lu";

// The serif display face (Sentient) is declared once in apps/ui globals.scss.
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
import { useProjectReach } from "./components/use-project-reach.ts";

/**
 * The application shell is not this page's: chrome layout draws it. One home for every
 * reader; Langy's gate only decides what the hero offers, so the page waits for it rather
 * than drawing a hero that changes under the reader. Spec: specs/home/langy-home.feature
 */
export function HomePage() {
  const langyResolving = useProjectHomeHost().langyVisibility().isResolving;

  return (
    <>
      {/* `clip`, not `hidden`. The lit block's bloom bleeds sideways past its box
          on purpose; on a narrow viewport that bleed caused a horizontal scrollbar.
          `overflow: hidden` forces the cross axis to `auto` too, breaking page scroll.
          `overflow-x: clip` clips just the one axis, so DOWN bleed still works. */}
      <Box width="full" position="relative" overflowX="clip">
        {/* zIndex={1} is load-bearing: it is the stacking context the
            lantern's zIndex -1 light sits in, above the layout's page fill. */}
        <Container maxW="7xl" padding={5} position="relative" zIndex={1}>
          <VStack gap={4} width="full" align="start">
            {/* The greeting lives in the hero, where the question is asked. The one
                sales-y ask sits here: the line and the demo pill, together or not at all. */}
            <HStack width="full" align="center" gap={2}>
              <Spacer />
              <ConsideringLangWatch />
            </HStack>

            {/* First, ops' unfinished operator steps for whoever holds ops:view. */}
            <UpgradeActionNeeded />
            {/* Whoever can answer a join request sees the wait wherever the home
                opens. Organization draws nothing for anyone else. */}
            <PendingJoinRequests />

            {langyResolving ? <HomeSkeleton /> : <LangyHome />}

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
        textStyle="caption"
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
        textStyle="caption"
        whiteSpace="nowrap"
        color="fg.muted"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="full"
        paddingX={2.5}
        paddingY="1"
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

/** What the page shows while Langy's gate answers: the shape of the home, committing to nothing. */
function HomeSkeleton() {
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
      <HomePageBanners>
        <LangyHomeHero />
      </HomePageBanners>
      {isNewProject ? (
        <OnboardingProgress />
      ) : (
        <>
          <TracesOverview />
          <RecentItemsSection />
          <OnboardingProgress />
        </>
      )}
      {/* The guided route into the docs, beside the footer's quiet link list: for a
          reader who'd rather read the docs first than ask in plain language. */}
      <DocsGuides />
    </>
  );
}

/**
 * The home route the page loader resolves. A safe `return_to` lands back there once the
 * scope has resolved; a project whose navigation has no home (an aggregate, ADR-177) is
 * replaced by its entry path, so Back leaves the project. Nothing renders meanwhile.
 */
export function HomeScreen() {
  const host = useProjectHomeHost();
  const returnTo = safeReturnToPath(host.returnTo());
  const isReady = !host.isLoading();
  const project = host.project();
  const entryPath =
    project && !projectNavigation(project.kind).home
      ? projectEntryPath({ slug: project.slug, kind: project.kind })
      : null;

  useEffect(() => {
    if (returnTo) {
      if (isReady) host.navigate(returnTo);
      return;
    }
    if (entryPath) host.navigate(entryPath, { replace: true });
  }, [host, returnTo, isReady, entryPath]);

  return returnTo || entryPath ? null : <HomePage />;
}

export default HomeScreen;
