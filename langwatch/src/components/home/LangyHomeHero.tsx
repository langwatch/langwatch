import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandPalette } from "~/features/command-bar/CommandPalette";
import { useCommandBar } from "~/features/command-bar/CommandBarContext";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { selectLangySuggestions } from "~/features/langy/logic/langyHomeSuggestions";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useHomeDevState } from "./dev/homeDevState";
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
 * THE FIELD IS THE COMMAND PALETTE. Not a copy of it, not a second box that
 * happens to look similar: the same component the Cmd+K bar renders, mounted
 * inline at hero size. So it navigates, it jumps to a trace by id, it searches
 * — and Tab, or the last row of its results, hands what you typed to Langy.
 * One field, one grammar, two doors. Pressing Cmd+K on this page puts the
 * caret here instead of raising a second identical bar over the top.
 *
 * NOTHING HERE CHANGES HEIGHT as the field is used. Its results are an overlay,
 * so opening them never pushes the figures and recent work down the page, and
 * the row of asks beneath keeps its footprint in every state.
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

export function LangyHomeHero() {
  const devState = useHomeDevState();
  const { registerInlinePalette } = useCommandBar();

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
  // Only once the answer is actually known. Leading with "send your first
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

  // The home's own query, deliberately NOT the Cmd+K bar's. The two are the
  // same palette but not the same session: what someone half-typed here should
  // not be sitting in the raised bar on the next page.
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  const focusField = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(
    () => registerInlinePalette(focusField),
    [registerInlinePalette, focusField],
  );

  // Blur closes the results, but not while the click that caused it is landing
  // on a result: the mousedown fires first, and standing down there would
  // unmount the row before its click ever arrived.
  const onBlur = useCallback(() => {
    window.setTimeout(() => {
      if (!fieldRef.current?.contains(document.activeElement)) setFocused(false);
    }, 0);
  }, []);

  const standDown = useCallback(() => {
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }, []);

  return (
    <VStack align="center" gap={{ base: 5, md: 6 }} width="full">
      {/* The page's one big line, and it belongs here rather than in the
          corner: on a home whose subject is a question, the greeting is who
          the question is addressed to. */}
      <WelcomeHeader />

      <VStack align="center" gap={3} width="full" maxWidth={ASK_MEASURE}>
        <Box
          ref={fieldRef}
          width="full"
          position="relative"
          background="bg.panel/92"
          borderWidth="1px"
          borderColor={focused ? "border.emphasized" : "border.muted"}
          borderRadius="16px"
          boxShadow={
            focused
              ? "0 2px 8px rgba(20, 20, 23, 0.08), 0 24px 70px -20px rgba(20, 20, 23, 0.35)"
              : "0 1px 2px rgba(20, 20, 23, 0.04), 0 12px 30px -22px rgba(20, 20, 23, 0.5)"
          }
          transition="border-color 130ms ease, box-shadow 130ms ease"
          onKeyDown={(event) => {
            if (event.key === "Escape") standDown();
          }}
        >
          <CommandPalette
            surface="inline"
            active={focused}
            query={query}
            setQuery={setQuery}
            onDone={standDown}
            inputRef={inputRef}
            onFocus={() => setFocused(true)}
            onBlur={onBlur}
            placeholder={
              canAsk
                ? isNewProject
                  ? "Ask Langy how to get started, or search"
                  : "Ask Langy, search, or jump to anything"
                : "Search, or jump to anything"
            }
          />
        </Box>

        {/* The row under the field: asks worth borrowing, and the concrete way
            to wire an agent up. Two honest routes into the product, and on a
            centred column they belong on the centre line together rather than
            at opposite ends of the page.

            It keeps its height while the project's reach is still being read,
            because there are no honest asks to show until that lands. */}
        <Box
          width="full"
          minHeight={ASK_ROW_MIN_HEIGHT}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <HStack gap={2} flexWrap="wrap" justify="center">
            {/* On a project with nothing in it, this leads. Everything else on
                the page describes data that does not exist yet, so the one
                control that changes that is not the quiet outline at the end of
                the row: it comes first and it fills in. */}
            {leadWithOnboarding ? (
              <OnboardAgentPill
                prominent
                onAskLangy={canAsk ? askLangy : undefined}
              />
            ) : null}
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
            {!leadWithOnboarding ? (
              <OnboardAgentPill onAskLangy={canAsk ? askLangy : undefined} />
            ) : null}
          </HStack>
        </Box>

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

/**
 * One borrowable ask.
 *
 * Its surface is deliberately near-opaque. These sit over a moving gradient,
 * and a translucent chip on a moving ground is legible only for as long as the
 * ground happens to be dark behind it.
 */
function AskChip({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="inline-flex"
      alignItems="center"
      gap={1.5}
      fontFamily="mono"
      fontSize="11.5px"
      color="fg.muted"
      background="bg.panel/90"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="full"
      paddingX={3}
      paddingY="4px"
      cursor="pointer"
      whiteSpace="nowrap"
      transition="color 130ms ease, border-color 130ms ease, background 130ms ease"
      _hover={{
        color: "orange.fg",
        borderColor: "orange.emphasized",
        background: "bg.panel",
      }}
    >
      <chakra.span display="grid" color="fg.subtle">
        {icon}
      </chakra.span>
      {label}
    </chakra.button>
  );
}
