import { Box, chakra, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { LuArrowRight } from "react-icons/lu";
import { ComposerMorphGhost } from "~/features/langy/components/ComposerMorphGhost";
import { Composer } from "~/features/langy/components/Composer";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useComposerMorph } from "~/features/langy/hooks/useComposerMorph";
import { selectLangySuggestions } from "~/features/langy/logic/langyHomeSuggestions";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useHomeDevState } from "./dev/homeDevState";
import { OnboardAgentPill } from "./OnboardAgentPill";
import { useProjectReach } from "./useProjectReach";

/**
 * The Langy home's lit block.
 *
 * One card, four layers: the shared moving canvas as its ground (owned by
 * HomePageBanners, which this composes rather than replaces, so the page never
 * carries two), the current announcement as a single line of chrome across the
 * top, the REAL Langy composer set into its lower edge on glass, and a row of
 * example asks beneath it.
 *
 * The composer is the real component in a `hero` variant, not a mock and not a
 * fork: it reads and writes the same draft the panel's does, so when it leaves
 * for the panel on send there is nothing to synchronise and nothing to retype.
 *
 * Spec: specs/home/langy-home.feature, specs/home/langy-home-morph.feature
 */
export function LangyHomeLantern() {
  const devState = useHomeDevState();
  const heroCardRef = useRef<HTMLDivElement>(null);

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
  // of nothing: the reader reaches for a chip that moves. A pinned dev state
  // is an answer, so it skips the wait.
  const reachKnown = devState === "empty" || devState === "populated" || !reach.isLoading;
  // Only once the answer is actually known. Leading with "send your first
  // trace" at a project that already has thousands is the product not knowing
  // its own customer, and `isNewProject` reads false while the check is still
  // in flight — the same trap the suggestions above guard against.
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

  const modelOverride = useLangyStore((s) => s.modelOverride);
  const setModelOverride = useLangyStore((s) => s.setModelOverride);
  const isOpen = useLangyStore((s) => s.isOpen);
  const openPanel = useLangyStore((s) => s.openPanel);
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const pendingPrompt = useLangyStore((s) => s.pendingPrompt);

  // Previewing a destination means actually using it: the two land in
  // genuinely different places, so a preview that only relabelled the state
  // would be showing the one thing the reader is trying to check.
  const setPanelMode = useLangyStore((s) => s.setPanelMode);
  useEffect(() => {
    if (devState === "docked") setPanelMode("sidebar");
    if (devState === "floating") setPanelMode("floating");
  }, [devState, setPanelMode]);

  const { flight, ask, reduceMotion, announcement } = useComposerMorph({
    heroCardRef,
    hold: devState === "morph",
    forceReducedMotion: devState === "reduced-motion",
  });

  // Once a conversation is under way the hero stands down. Two composers on
  // one conversation is one mouth too many: this one starts conversations, the
  // panel's continues them. The slot keeps the bar's height either way, so the
  // block never collapses by 46px the moment the bar leaves.
  const conversationOpen =
    devState === "after-turn" ||
    devState === "stalled" ||
    (!!pendingPrompt || (isOpen && !!activeConversationId));

  const stalled = devState === "stalled";

  const continueInLangy = () => {
    openPanel();
    document
      .querySelector<HTMLElement>('[data-langy-composer="panel"]')
      ?.querySelector("textarea")
      ?.focus();
  };

  return (
    <>
      <VStack align="stretch" gap={3} width="full">
        <Box
          minHeight="46px"
          display="flex"
          position="relative"
          // The hero keeps its space while its bar is away, so nothing under
          // the block jumps when a conversation starts.
          visibility={flight ? "hidden" : "visible"}
        >
          {!canAsk ? (
            <ReadOnlyNotice />
          ) : (
            <>
              {/* The composer is hidden in place, never unmounted: the slot
                  always holds the composer's own height, so swapping to the
                  continue line cannot move anything below (the input is
                  taller than the 46px floor). visibility also removes it
                  from pointer + a11y trees while hidden. */}
              <Box
                flex={1}
                minWidth={0}
                visibility={conversationOpen ? "hidden" : "visible"}
              >
                <Composer
                  variant="hero"
                  cardRef={heroCardRef}
                  model={modelOverride}
                  modelOptions={[]}
                  onModelChange={setModelOverride}
                  onSend={ask}
                  onStop={() => undefined}
                  disabled={false}
                  placeholder={
                    isNewProject
                      ? "Ask Langy how to get started"
                      : "Ask Langy or describe what you want"
                  }
                />
              </Box>
              {conversationOpen ? (
                // Absolute, filling the composer's reserved footprint: the
                // slot keeps its height (nothing below jumps) AND the space
                // reads as an intentional resume card rather than a short line
                // stranded in emptiness.
                <ContinueLine stalled={stalled} onContinue={continueInLangy} />
              ) : null}
            </>
          )}
        </Box>

        {/* The row under the composer: example asks on the left, the concrete
            way to wire an agent up on the right. Two honest routes into the
            product side by side, which is why the onboarding control moved up
            here from the docs card three screens below.

            The asks are hidden once a conversation is open (the panel has its
            own follow-ups, and two competing sets of chips is one too many)
            and hidden from a reader who cannot send them. The onboarding
            control stays either way: it never needed permission to start a
            turn, and a read-only reader can still go and instrument a service. */}
        <HStack gap={2} flexWrap="wrap" width="full">
          {/* On a project with nothing in it, this leads. Everything else on
              the page — the asks, the figures, the recent work — describes
              data that does not exist yet, so the one control that changes
              that cannot be the quiet outline at the end of the row. It moves
              to the front and fills in. Once traces are arriving it goes back
              to being one option among several, because then it is. */}
          {leadWithOnboarding ? (
            <OnboardAgentPill prominent onAskLangy={canAsk ? ask : undefined} />
          ) : null}
          {canAsk ? (
            suggestions.map((suggestion) => (
              <chakra.button
                key={suggestion.label}
                type="button"
                onClick={() => ask(suggestion.prompt)}
                // Hidden in place, never unmounted: the row keeps its exact
                // height (wrapped lines included) when a conversation opens,
                // so the lantern doesn't breathe every time the panel does.
                // visibility also drops them from pointer + a11y trees.
                visibility={conversationOpen ? "hidden" : "visible"}
                display="inline-flex"
                alignItems="center"
                gap={1.5}
                fontFamily="mono"
                fontSize="11px"
                color="fg.muted"
                background="bg.panel/70"
                backdropFilter="blur(6px)"
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="full"
                paddingX={2.5}
                paddingY="4px"
                cursor="pointer"
                whiteSpace="nowrap"
                transition="color 130ms ease, border-color 130ms ease"
                _hover={{ color: "orange.fg", borderColor: "orange.emphasized" }}
              >
                <suggestion.icon size={12} />
                {suggestion.label}
              </chakra.button>
            ))
          ) : null}
          <Spacer />
          {!leadWithOnboarding ? (
            <OnboardAgentPill onAskLangy={canAsk ? ask : undefined} />
          ) : null}
        </HStack>
      </VStack>

      {/* What the animation says to everyone else, said once, politely. */}
      <chakra.span
        aria-live="polite"
        position="absolute"
        width="1px"
        height="1px"
        overflow="hidden"
        clipPath="inset(50%)"
        whiteSpace="nowrap"
      >
        {reduceMotion ? announcement : ""}
      </chakra.span>

      {flight ? <ComposerMorphGhost flight={flight} /> : null}
    </>
  );
}

/**
 * The hero slot while a conversation is open.
 *
 * It offers a way back rather than a second place to talk: clicking it focuses
 * the conversation that already exists, and never starts a new one.
 */
function ContinueLine({
  stalled,
  onContinue,
}: {
  stalled: boolean;
  onContinue: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onContinue}
      // Fills the composer's reserved box (its parent is position:relative),
      // so the resume affordance occupies the space the composer left rather
      // than floating a thin line in it — same height, no emptiness.
      position="absolute"
      inset={0}
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      gap={3}
      textAlign="left"
      paddingX={5}
      borderRadius="18px"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      background="bg.panel/70"
      backdropFilter="blur(8px)"
      cursor="pointer"
      color="fg.muted"
      transition="color 130ms ease, border-color 130ms ease, background 130ms ease"
      _hover={{
        color: "fg",
        borderColor: "border.emphasized",
        background: "bg.panel/80",
      }}
    >
      <VStack align="start" gap={1} minWidth={0}>
        <Text fontFamily="mono" fontSize="13px" color="fg">
          {stalled ? "Langy is still working" : "Continue your conversation"}
        </Text>
        <Text fontSize="xs" color="fg.subtle">
          {stalled
            ? "Its answer is on the way — open the panel to watch it land."
            : "Your chat is open in the panel. Pick up where you left off."}
        </Text>
      </VStack>
      <Box
        flexShrink={0}
        display="grid"
        placeItems="center"
        boxSize="30px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        color="fg.muted"
      >
        <LuArrowRight size={15} aria-hidden />
      </Box>
    </chakra.button>
  );
}

/**
 * What a reader who may read Langy but not start conversations meets instead
 * of a composer.
 *
 * No link and no button: this is not a setting they can reach. Permissions are
 * granted by whoever manages their account, so the only honest thing the page
 * can do is say so and get out of the way. Offering a control that leads to a
 * page they cannot act on would be worse than saying nothing.
 */
function ReadOnlyNotice() {
  return (
    <HStack
      flex={1}
      height="46px"
      paddingX={4}
      borderRadius="18px"
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.muted"
      background="bg.panel/60"
      backdropFilter="blur(8px)"
    >
      <Text fontSize="12.5px" color="fg.muted">
        You can read Langy conversations here. To start one, ask whoever manages
        your account for access.
      </Text>
    </HStack>
  );
}
