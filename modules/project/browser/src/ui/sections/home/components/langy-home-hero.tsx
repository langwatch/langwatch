import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { AskChip } from "@langwatch/design-system/ask-chip";
import { selectLangySuggestions, useLangyStore } from "@langwatch/langy-browser-kit";

import { GuidedOnboardingOffer } from "../../../../behavior/lent-peers.tsx";
import { useProjectHomeHost } from "../../../../model/project-home-host.ts";

import "./homeHeroScroll.css";
import { ContinueLine } from "./continue-line.tsx";
import { HeroAskField } from "./hero-ask-field.tsx";
import { OnboardAgentPill } from "./onboard-agent-pill.tsx";
import { useConversationOpen } from "./use-conversation-open.ts";
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

/**
 * The height the field holds at hero size, which the continue line takes over so the
 * column never moves when a conversation opens or closes.
 */
const CONTINUE_SLOT_HEIGHT = "58px";

function askPlaceholder(canAsk: boolean, isNewProject: boolean): string {
  if (!canAsk) return "Search, or jump to anything";
  if (isNewProject) return "Ask Langy how to get started, or search";
  return "Ask Langy, search, or jump to anything";
}

/** The hero's one field, or the way back into the conversation that is open. */
function HeroField({ canAsk, isNewProject }: { canAsk: boolean; isNewProject: boolean }) {
  const { conversationOpen, continueInLangy } = useConversationOpen();
  if (canAsk && conversationOpen) {
    return (
      <Box width="full" height={CONTINUE_SLOT_HEIGHT} display="flex" justifyContent="center">
        <ContinueLine onContinue={continueInLangy} />
      </Box>
    );
  }
  return <HeroAskField placeholder={askPlaceholder(canAsk, isNewProject)} />;
}

export function LangyHomeHero() {
  const canAsk = useProjectHomeHost().canAskLangy();

  const reach = useProjectReach();
  const { isNewProject } = reach;

  // Until the project's reach is known, "has nothing" and "has not answered
  // yet" look identical, and offering the empty-project asks to a project with
  // months of runs (then swapping them out a beat later) is worse than a beat
  // of nothing: the reader reaches for a chip that moves.
  const reachKnown = !reach.isLoading;
  // Only once the answer is actually known: leading with "send your first
  // trace" at a project that already has thousands is the product not knowing
  // its own customer, and `isNewProject` reads false while the check is still
  // in flight.
  const leadWithOnboarding = reachKnown && isNewProject;
  const suggestions = !reachKnown ? [] : selectLangySuggestions({ reach });

  const askLangy = useLangyStore((s) => s.askLangy);
  const { conversationOpen } = useConversationOpen();

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
        <HeroField canAsk={canAsk} isNewProject={isNewProject} />

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
            {/* Hidden in place while a conversation is open, never unmounted, so the
                row keeps its height when the panel opens. */}
            <HStack
              gap={2}
              flexWrap="wrap"
              justify="center"
              visibility={conversationOpen ? "hidden" : "visible"}
            >
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
          <GuidedOnboardingOffer space="project" spaceInUse={reachKnown ? !isNewProject : null} />
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
