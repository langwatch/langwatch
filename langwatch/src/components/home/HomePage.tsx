import {
  Box,
  chakra,
  Container,
  Grid,
  HStack,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { LuCalendarClock } from "react-icons/lu";
// The page's serif display voice (Sentient) is declared in langyTheme.css.
// Imported HERE, not just via Langy components, so the greeting, banner, and
// recents headings render the real face on every home — including the one
// where no Langy surface mounts.
import "~/features/langy/langyTheme.css";
import {
  BriefingMockSwitcher,
  HomeBriefingSection,
  SetupHairline,
} from "~/features/briefing";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { DashboardLayout } from "../DashboardLayout";
import { HomeStateSwitcher } from "./dev/HomeStateSwitcher";
import { chartVariantFor, useHomeDevState } from "./dev/homeDevState";
import { DocsGuides } from "./DocsGuides";
import { HomeFortune } from "./HomeFortune";
import { HomePageBanners } from "./HomePageBanners";
import { LangyHomeLantern } from "./LangyHomeLantern";
import { LearningResources } from "./LearningResources";
import { OnboardingProgress } from "./OnboardingProgress";
import { RecentItemsSection } from "./RecentItemsSection";
import { TimeOfDayAura } from "./TimeOfDayAura";
import { TracesOverview } from "./TracesOverview";
import { useHomeComposition } from "./useHomeComposition";
import { useProjectReach } from "./useProjectReach";
import { useTimeOfDay, WelcomeHeader } from "./WelcomeHeader";

/**
 * The project home: a briefing for the returning user, not a lobby. Live
 * signal (the sheet, recent items) over navigation — the sidebar already
 * lists the feature areas, so home never repeats it as cards. Onboarding
 * shows only while incomplete; resources are a quiet footer.
 *
 * Three compositions, resolved in strict order by `useHomeComposition`:
 *
 *   - SIGNAL-FOCUSED: the generated briefing sheet leads — LangWatch's read
 *     of the project's agentic signals, with the status figures folded in —
 *     then the announcement note, recent work, and setup as a hairline.
 *   - LANGY: the lit block leads, announcement compressed into a line of its
 *     chrome and a real composer set into its lower edge, then the same spine
 *     the classic home has, with the overview reduced to a compact strip.
 *   - CLASSIC: announcements, the traces overview, recent work, and the
 *     onboarding checklist.
 *
 * The ORDER matters more than the branches: signal-focused wins outright, and
 * Langy access alone still switches nothing (the Langy home needs its own
 * rollout too). Within any composition, Langy access decides only the Langy
 * affordances: the sheet's hand-to-Langy controls gate themselves
 * (HomeBriefingSection / QuietHeadline), and the classic traces overview
 */
export function HomePage() {
  const composition = useHomeComposition();
  const timeOfDay = useTimeOfDay();

  return (
    <DashboardLayout>
      {/* No overflow clipping here — it breaks the page scroll; the aura
          canvas is inset within this box and cannot bleed anyway. */}
      <Box width="full" position="relative">
        {/* The day's light, leaking in from the panel's top-left corner and
            backlighting the greeting. Canvas-drawn in Display-P3 where the
            screen supports it. The sidebar never wears it. */}
        <TimeOfDayAura timeOfDay={timeOfDay} />
        {/* A reading measure, not a dashboard sprawl: the briefing sheet is
            the page, so the column narrows to keep its lines composed. */}
        <Container maxW="7xl" padding={5} position="relative" zIndex={1}>
          <VStack gap={4} width="full" align="start">
            <HStack width="full" align="center" gap={2}>
              <WelcomeHeader />
              <Spacer />
              {/* The one sales-y ask: the friendly line, small and quiet, with
                  the demo link as a compact pill beside it. Shown to people who
                  might still buy, and to nobody else.

                  The line and the pill go together or not at all: the pill is
                  the ask and the line is what sets it up, so hiding one would
                  leave a bare "Request a demo" with nothing explaining it. */}
              <ConsideringLangWatch />
            </HStack>

            {composition === "signal-focused" ? (
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
    </DashboardLayout>
  );
}

/**
 * The home page's one sales-y ask, and who is spared it.
 *
 * A customer who already pays for LangWatch should not be pitched LangWatch on
 * their own home page every morning. So the ask is for people who might still
 * buy: it renders only once we KNOW the organization is on the free plan.
 *
 * "Only once we know" is doing real work there. While the plan is still
 * resolving the answer is unknown, and the two ways of being wrong are not
 * equally bad: a free user meeting the ask a beat late costs nothing, while a
 * paying customer watching a "considering LangWatch?" pitch flash up and
 * disappear is the product forgetting who they are. So unknown hides it.
 *
 * Lives here, above the composition branch, because the greeting row is shared
 * chrome: fixing it once is what stops it coming back on whichever home a
 * future rollout happens to render.
 *
 * Spec: specs/home/home-views.feature
 */
function ConsideringLangWatch() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const activePlan = api.plan.getActivePlan.useQuery(
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
 * The Langy home's spine.
 *
 * The lit block leads, then the page continues in the order it already has.
 * The one thing that moves is the setup checklist: on a project with no data
 * it takes the figures' place directly under the block, because there are no
 * figures worth showing yet and the next thing that reader needs is a first
 * trace, not an empty chart. On a project with data it stays where it always
 * was, below recent work, and only shows while it is incomplete.
 *
 * Spec: specs/home/langy-home.feature
 */
function LangyHome() {
  const { isNewProject } = useProjectReach();
  const devState = useHomeDevState();
  const empty =
    devState === "empty" ? true : devState === "populated" ? false : isNewProject;

  return (
    <>
      <HomePageBanners variant="lantern">
        <LangyHomeLantern />
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
      <DocsGuides showOnboardPill={false} />
    </>
  );
}
