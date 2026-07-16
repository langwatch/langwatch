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
import { useShowLangy } from "~/features/langy/hooks/useShowLangy";
import { DashboardLayout } from "../DashboardLayout";
import { DocsGuides } from "./DocsGuides";
import { HomeFortune } from "./HomeFortune";
import { HomePageBanners } from "./HomePageBanners";
import { LearningResources } from "./LearningResources";
import { OnboardingProgress } from "./OnboardingProgress";
import { RecentItemsSection } from "./RecentItemsSection";
import { TimeOfDayAura } from "./TimeOfDayAura";
import { TracesOverview } from "./TracesOverview";
import { useTimeOfDay, WelcomeHeader } from "./WelcomeHeader";

/**
 * The project home: a briefing for the returning user, not a lobby. Live
 * signal (the sheet, recent items) over navigation — the sidebar already
 * lists the feature areas, so home never repeats it as cards. Onboarding
 * shows only while incomplete; resources are a quiet footer.
 *
 * Exactly two compositions, decided by the Langy gate (useShowLangy):
 *
 *   - WITH Langy: the generated briefing sheet leads — LangWatch's read of
 *     the project's agentic signals, with the status figures folded in —
 *     then the announcement note, recent work, and setup as a hairline.
 *   - WITHOUT Langy: the classic home — announcements, the traces overview,
 *     recent work, and the onboarding checklist (whose steps don't assume a
 *     panel the user doesn't have).
 */
export function HomePage() {
  const showLangy = useShowLangy();
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
                  the demo link as a compact pill beside it. */}
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
            </HStack>

            {showLangy ? (
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
            ) : (
              <>
                <HomePageBanners />
                <TracesOverview />
                <RecentItemsSection />
                <OnboardingProgress />
              </>
            )}

            {/* Dev-only chrome (the briefing mock switcher) belongs with the
                footer links, not next to the greeting. */}
            <LearningResources trailing={<BriefingMockSwitcher />} />
          </VStack>
        </Container>
      </Box>
    </DashboardLayout>
  );
}
