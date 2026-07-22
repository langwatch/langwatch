import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SERIF } from "~/features/asaplangy";
import { CommandPalette } from "~/features/command-bar/CommandPalette";
import { useCommandBar } from "~/features/command-bar/CommandBarContext";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { selectLangySuggestions } from "~/features/langy/logic/langyHomeSuggestions";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { copyCodingAgentBrief } from "./codingAgentBrief";
import { useHomeDevState } from "./dev/homeDevState";
import "./homeHeroScroll.css";
import { useProjectReach } from "./useProjectReach";
import { WelcomeHeader } from "./WelcomeHeader";

/**
 * The Langy home's opening: a greeting, one field, and the asks worth
 * borrowing.
 *
 * It is a CENTRED COLUMN, not a card. The page's question is "what do you want
 * to do", and the honest shape for that is the shape a search field has always
 * had: one field on the centre line with room around it.
 *
 * EVERYTHING BELOW THE FIELD IS TYPOGRAPHY, NOT CHROME. This zone used to
 * stack three visual systems — a filled onboarding pill carrying its own icon
 * tiles and caret, a row of bordered mono chips, and an announcement ticker
 * with pagination bars — five bordered capsules arguing with the one field
 * above them. Now the asks are set as quoted speech in the page's serif (the
 * reader's own words, ready to borrow), and the only other line is the quiet
 * setup brief an empty project offers. No borders, no fills, no glyph
 * clusters: the field is the only object, and the words under it are words.
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
 * the line of asks beneath keeps its footprint in every state.
 *
 * Spec: specs/home/langy-home.feature
 */

/** The field's reading measure. Wider and it stops reading as one question. */
const ASK_MEASURE = "680px";

/**
 * The height the ask line holds in every state.
 *
 * One serif line's box. Pinned because the line has to keep this height while
 * it has nothing to show — during the read of what the project holds — and a
 * line that sized itself to its contents would grow under the reader as that
 * answer arrived.
 */
const ASK_ROW_MIN_HEIGHT = "24px";

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
  // of nothing: the reader reaches for an ask that moves. A pinned dev state is
  // an answer, so it skips the wait.
  const reachKnown =
    devState === "empty" || devState === "populated" || !reach.isLoading;
  // Only once the answer is actually known: `isNewProject` reads false while
  // the check is still in flight, and the setup brief flashing in and out is
  // the product changing its mind under the reader.
  const offerSetupBrief = reachKnown && isNewProject;
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
      if (!fieldRef.current?.contains(document.activeElement))
        setFocused(false);
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
          the question is addressed to.

          It is also the first thing to go on the way down the page: the
          wrapper carries the scroll-driven drift-and-dissolve (see
          homeHeroScroll.css), which is why the line has a box of its own. */}
      <Box className="langy-home-greeting">
        <WelcomeHeader />
      </Box>

      <VStack align="center" gap={3} width="full" maxWidth={ASK_MEASURE}>
        <Box
          ref={fieldRef}
          width="full"
          position="relative"
          background="bg.panel/60"
          borderWidth="1px"
          borderColor={focused ? "border" : "border.muted"}
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

        <VStack width="full" gap={2} align="center">
          {/* The asks, as speech. Each is a sentence the reader could have
              typed into the field above — so it is set as one, in the page's
              serif with real quotation marks, and clicking it sends those
              words. A row of bordered chips promised buttons; a line of
              quoted asks demonstrates the field's grammar instead.

              The line keeps its height while the project's reach is still
              being read, because there are no honest asks to show until that
              lands. */}
          <Box
            width="full"
            minHeight={ASK_ROW_MIN_HEIGHT}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <HStack
              gap={{ base: 3, md: 5 }}
              rowGap={1}
              flexWrap="wrap"
              justify="center"
            >
              {canAsk
                ? suggestions.map((suggestion) => (
                    <AskLine
                      key={suggestion.label}
                      label={suggestion.label}
                      onClick={() => askLangy(suggestion.prompt)}
                    />
                  ))
                : null}
            </HStack>
          </Box>

          {/* The route for the reader whose agent lives in an editor: one
              quiet line that hands them a brief their own coding agent can
              act on. Only while the project is empty — the moment a trace
              arrives this is the product not knowing its own customer, and on
              a populated project the docs section carries the onboarding
              control instead (see LangyHome). Langy-led onboarding is not
              repeated here: it is already the first ask above. */}
          {offerSetupBrief ? <SetupBriefLine connective={canAsk} /> : null}
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

/**
 * One borrowable ask, set as the speech it is.
 *
 * Text only — no border, no fill, no icon. Over the moving gradient a chip
 * needed a near-opaque surface to stay legible; a line of dark serif at text
 * weight reads the way the greeting above it does, and the quotation marks are
 * what say "type this" before any affordance has to. The marks live in
 * pseudo-elements so the accessible name stays the ask itself.
 */
function AskLine({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      aria-label={label}
      fontFamily={SERIF}
      fontSize="14.5px"
      fontWeight="400"
      lineHeight="1.5"
      color="fg.muted"
      background="transparent"
      borderWidth={0}
      padding={0}
      cursor="pointer"
      whiteSpace="nowrap"
      transition="color 130ms ease"
      _hover={{ color: "orange.fg" }}
      _before={{ content: '"“"' }}
      _after={{ content: '"”"' }}
    >
      {label}
    </chakra.button>
  );
}

/**
 * The empty project's one quiet action that is not an ask.
 *
 * A dotted underline, not a border: it does something (copies the brief and
 * confirms with a toast), so it carries the one hint of affordance the ask
 * line above deliberately does not. The leading "or" ties it to the asks as
 * their alternative — except when the asks are hidden (a reader who cannot
 * start conversations), where a bare "or" would dangle from nothing.
 */
function SetupBriefLine({ connective }: { connective: boolean }) {
  return (
    <chakra.button
      type="button"
      onClick={copyCodingAgentBrief}
      fontSize="12px"
      color="fg.subtle"
      background="transparent"
      borderWidth={0}
      padding={0}
      cursor="pointer"
      whiteSpace="nowrap"
      textDecoration="underline"
      textDecorationStyle="dotted"
      textUnderlineOffset="3px"
      transition="color 130ms ease"
      _hover={{ color: "orange.fg" }}
    >
      {connective
        ? "or copy a setup brief for your coding agent"
        : "Copy a setup brief for your coding agent"}
    </chakra.button>
  );
}
