import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { AskChip } from "@langwatch/design-system/ask-chip";
import { selectLangySuggestions, useLangyStore } from "@langwatch/langy-browser-kit";

import { useProjectHomeHost } from "../../../../model/project-home-host.ts";
import { type HomeDevState, useHomeDevState } from "./dev/home-dev-state.ts";

import "./homeHeroScroll.css";
import { HeroAskField } from "./hero-ask-field.tsx";
import { OnboardAgentPill } from "./onboard-agent-pill.tsx";
import { useProjectReach } from "./use-project-reach.ts";
import { WelcomeHeader } from "./welcome-header.tsx";

/**
 * Langy home hero: greeting, command palette field, and suggested asks.
 * Centred column layout; results overlay without changing height.
 */

/** The field's reading measure. Wider and it stops reading as one question. */
const ASK_MEASURE = "680px";

/**
 * The height the ask row holds in every state — one chip's line box plus
 * padding/border, pinned so the row doesn't grow under the reader once
 * the read of what the project holds arrives.
 */
const ASK_ROW_MIN_HEIGHT = "26px";

function isNewProjectFor(devState: HomeDevState | null, detected: boolean): boolean {
  if (devState === "empty") return true;
  if (devState === "populated") return false;
  return detected;
}

type SuggestionReach = Parameters<typeof selectLangySuggestions>[0]["reach"];

function suggestionReachFor(
  devState: HomeDevState | null,
  detected: SuggestionReach,
): SuggestionReach {
  if (devState === "empty") {
    return { hasTraces: false, hasEvaluations: false, hasExperiments: false };
  }
  if (devState === "populated") {
    return { hasTraces: true, hasEvaluations: true, hasExperiments: true };
  }
  return detected;
}

function askPlaceholder(canAsk: boolean, isNewProject: boolean): string {
  if (!canAsk) return "Search, or jump to anything";
  if (isNewProject) return "Ask Langy how to get started, or search";
  return "Ask Langy, search, or jump to anything";
}

export function LangyHomeHero() {
  const devState = useHomeDevState();

  const realCanAsk = useProjectHomeHost().canAskLangy();
  const canAsk = devState === "read-only" ? false : realCanAsk;

  const reach = useProjectReach();
  const isNewProject = isNewProjectFor(devState, reach.isNewProject);

  // Until the project's reach is known, "has nothing" and "has not answered
  // yet" look identical, and offering the empty-project asks to a project with
  // months of runs (then swapping them out a beat later) is worse than a beat
  // of nothing: the reader reaches for a chip that moves. A pinned dev state is
  // an answer, so it skips the wait.
  const reachKnown = devState === "empty" || devState === "populated" || !reach.isLoading;
  // Only once the answer is actually known: leading with "send your first
  // trace" at a project that already has thousands is the product not knowing
  // its own customer, and `isNewProject` reads false while the check is still
  // in flight.
  const leadWithOnboarding = reachKnown && isNewProject;
  const suggestions = !reachKnown
    ? []
    : selectLangySuggestions({ reach: suggestionReachFor(devState, reach) });

  const askLangy = useLangyStore((s) => s.askLangy);

  return (
    <VStack align="center" gap={{ base: 5, md: 6 }} width="full">
      {/* The page's one big line, and it belongs here rather than in the
          corner: on a home whose subject is a question, the greeting is who
          the question is addressed to.

          It is also the first thing to go on the way down the page: the
          wrapper carries the scroll-driven drift-and-dissolve (see
          homeHeroScroll.css), which is why the line has a box of its own. */}
      <Box className="langy-home-greeting">
        <WelcomeHeader />
      </Box>

      <VStack align="center" gap={3} width="full" maxWidth={ASK_MEASURE}>
        <HeroAskField placeholder={askPlaceholder(canAsk, isNewProject)} />

        {/* Prompts and onboarding action on separate centre lines, not one
            wrapping row. Row height fixed until project data arrives. */}
        <VStack width="full" gap={2.5} align="center">
          {/* On a project with nothing in it, this LEADS. Everything else on
              the page describes data that does not exist yet, so the one
              control that changes that comes first, which in a stack means
              above, not merely left. */}
          {leadWithOnboarding ? (
            <OnboardAgentPill prominent onAskLangy={canAsk ? askLangy : undefined} />
          ) : null}
          <Box
            width="full"
            minHeight={ASK_ROW_MIN_HEIGHT}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <HStack gap={2} flexWrap="wrap" justify="center">
              {canAsk
                ? suggestions.map((suggestion) => (
                    <AskChip
                      key={suggestion.label}
                      icon={<suggestion.icon size={12} />}
                      label={suggestion.label}
                      onClick={() => askLangy(suggestion.prompt)}
                    />
                  ))
                : null}
            </HStack>
          </Box>
          {!leadWithOnboarding && reachKnown ? (
            <OnboardAgentPill onAskLangy={canAsk ? askLangy : undefined} />
          ) : null}
        </VStack>

        {!canAsk ? (
          <Text fontSize="12px" color="fg.subtle" textAlign="center">
            You can read Langy conversations here. To start one, ask whoever manages your account
            for access.
          </Text>
        ) : null}
      </VStack>
    </VStack>
  );
}
