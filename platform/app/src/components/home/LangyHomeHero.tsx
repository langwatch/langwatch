import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { selectLangySuggestions } from "~/features/langy/logic/langyHomeSuggestions";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { AskChip } from "./AskChip";
import { ContinueLine, useConversationOpen } from "./ContinueLine";
import { useHomeDevState } from "./dev/homeDevState";
import { HeroAskField } from "./HeroAskField";
import "./homeHeroScroll.css";
import { GuidedOnboardingOffer } from "~/features/guided-onboarding/home/GuidedOnboardingOffer";
import { OnboardAgentPill } from "./OnboardAgentPill";
import { useProjectReach } from "./useProjectReach";
import { WelcomeHeader } from "./WelcomeHeader";

/**
 * The Langy home's opening: a greeting, one field, and the asks worth
 * borrowing.
 *
 * It is a CENTRED COLUMN, not a card. The page's question is "what do you want
 * to do", and the honest shape for that is the shape a search field has always
 * had: one field on the centre line with room around it. The block this
 * replaced put a text input inside a bordered panel with an announcement bar
 * across its top and a control shoved to the far right, which made the field
 * read as one widget on a dashboard rather than the thing the page is for.
 *
 * THE FIELD IS THE COMMAND PALETTE (`HeroAskField`): the same component the
 * Cmd+K bar renders, mounted inline at hero size, so it navigates, searches,
 * and hands what you typed to Langy. Its results are an overlay, so nothing
 * here changes height as the field is used, and the row of asks beneath keeps
 * its footprint in every state.
 *
 * Spec: specs/home/langy-home.feature
 */

/** The field's reading measure. Wider and it stops reading as one question. */
const ASK_MEASURE = "680px";

/**
 * The height the ask row holds in every state.
 *
 * One chip: its line box plus its padding and border. Pinned because the row
 * has to keep this height while it has nothing to show — during the read of
 * what the project holds — and a row that sized itself to its contents would
 * grow under the reader as that answer arrived.
 */
const ASK_ROW_MIN_HEIGHT = "26px";

/**
 * The height the field holds at hero size (CommandBarInput: a 16px line
 * inside 16px of padding each way, plus the box's border), which the
 * continue line takes over so the column never moves when a conversation
 * opens or closes.
 */
const CONTINUE_SLOT_HEIGHT = "58px";

/**
 * The hero's one field, or the way back into the conversation that is open.
 *
 * The field starts conversations and the panel's composer continues them, the
 * same rule the lantern keeps: while a conversation is open the slot holds
 * the continue line at the field's height, so nothing under it moves and
 * nothing typed on the home starts a second conversation.
 */
function HeroField({
  canAsk,
  isNewProject,
  devState,
}: {
  canAsk: boolean;
  isNewProject: boolean;
  devState: ReturnType<typeof useHomeDevState>;
}) {
  const { conversationOpen, stalled, continueInLangy } =
    useConversationOpen(devState);
  if (canAsk && conversationOpen) {
    return (
      <Box
        width="full"
        height={CONTINUE_SLOT_HEIGHT}
        display="flex"
        justifyContent="center"
      >
        <ContinueLine stalled={stalled} onContinue={continueInLangy} />
      </Box>
    );
  }
  return (
    <HeroAskField
      placeholder={
        canAsk
          ? isNewProject
            ? "Ask Langy how to get started, or search"
            : "Ask Langy, search, or jump to anything"
          : "Search, or jump to anything"
      }
    />
  );
}

export function LangyHomeHero() {
  const devState = useHomeDevState();

  const realCanAsk = useCanAskLangy();
  const canAsk = devState === "read-only" ? false : realCanAsk;

  const reach = useProjectReach();
  const isNewProject =
    devState === "empty"
      ? true
      : devState === "populated"
        ? false
        : reach.isNewProject;

  // Until the project's reach is known, "has nothing" and "has not answered
  // yet" look identical, and offering the empty-project asks to a project with
  // months of runs (then swapping them out a beat later) is worse than a beat
  // of nothing: the reader reaches for a chip that moves. A pinned dev state is
  // an answer, so it skips the wait.
  const reachKnown =
    devState === "empty" || devState === "populated" || !reach.isLoading;
  // Only once the answer is actually known: leading with "send your first
  // trace" at a project that already has thousands is the product not knowing
  // its own customer, and `isNewProject` reads false while the check is still
  // in flight.
  const leadWithOnboarding = reachKnown && isNewProject;
  const suggestions = !reachKnown
    ? []
    : selectLangySuggestions({
        reach:
          devState === "empty"
            ? { hasTraces: false, hasEvaluations: false, hasExperiments: false }
            : devState === "populated"
              ? { hasTraces: true, hasEvaluations: true, hasExperiments: true }
              : reach,
      });

  const askLangy = useLangyStore((s) => s.askLangy);
  const { conversationOpen } = useConversationOpen(devState);

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
        <HeroField
          canAsk={canAsk}
          isNewProject={isNewProject}
          devState={devState}
        />

        {/* TWO TIERS, not one wrapping row.
            The chips are prompts: click one and it goes to Langy. The
            onboarding control is an ACTION: it hands you something to take
            away, or a link to follow. They are different kinds, so the split
            is the composition: a settled row of asks, and the action on its
            own centre line. Every empty feature page also carries its own
            set-up-with-AI control, but the home is where a new project lands
            first, so the way in lives here too.

            The row keeps its height while the project's reach is still being
            read, because there are no honest asks to show until that lands. */}
        <VStack width="full" gap={2.5} align="center">
          {/* On a project with nothing in it, this LEADS. Everything else on
              the page describes data that does not exist yet, so the one
              control that changes that comes first, which in a stack means
              above, not merely left. */}
          {leadWithOnboarding ? (
            <OnboardAgentPill
              prominent
              onAskLangy={canAsk ? askLangy : undefined}
            />
          ) : null}
          <Box
            width="full"
            minHeight={ASK_ROW_MIN_HEIGHT}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            {/* Hidden in place while a conversation is open, never unmounted:
                the panel has its own follow-ups, and the row keeps its exact
                height so the column does not breathe when the panel does. */}
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
          <GuidedOnboardingOffer space="project" />
        </VStack>

        {!canAsk ? (
          <Text fontSize="12px" color="fg.subtle" textAlign="center">
            You can read Langy conversations here. To start one, ask whoever
            manages your account for access.
          </Text>
        ) : null}
      </VStack>
    </VStack>
  );
}
