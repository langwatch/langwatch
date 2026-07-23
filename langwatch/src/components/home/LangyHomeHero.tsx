import { Box, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandBar } from "~/features/command-bar/CommandBarContext";
import { CommandPalette } from "~/features/command-bar/CommandPalette";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
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
          /* One step darker on light: over the white bloom, border.muted was
             faint enough that the field lost its own edge. Dark keeps the
             quieter hairline; the darker ground already draws the box. */
          borderColor={
            focused
              ? { base: "border.emphasized", _dark: "border" }
              : { base: "border", _dark: "border.muted" }
          }
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
