import { Box } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAutoFocusInput } from "../../behavior/use-auto-focus-input";
import { useCommandBarItems } from "../../behavior/use-command-bar-items";
import { useCommandBarKeyboard } from "../../behavior/use-command-bar-keyboard";
import { useCommandSearch } from "../../behavior/use-command-search";
import { useEasterEggEffects } from "../../behavior/use-easter-egg-effects";
import { useFilteredCommands } from "../../behavior/use-filtered-commands";
import { useFilteredProjects } from "../../behavior/use-filtered-projects";
import { useRecentItems } from "../../behavior/use-recent-items";
import { useReducedMotion } from "../../behavior/use-reduced-motion";
import { useScrollIntoView } from "../../behavior/use-scroll-into-view";
import { findEasterEgg } from "../../model/command-easter-eggs";
import type { ListItem } from "../../model/command-icon-info";
import { beginLangyHandoff } from "../../model/command-langy-handoff";
import {
  handleCommandSelect,
  handleProjectSelect,
  handleRecentItemSelect,
  handleSearchResultSelect,
} from "../../model/command-select-handlers";
import { useNavigationHost } from "../../model/navigation-host";
import { CommandBarLangyMode } from "../blocks/command-bar-langy-mode";
import { CommandBarFooter } from "../elements/command-bar-footer";
import { CommandBarInput } from "../elements/command-bar-input";
import { HintsSection } from "../elements/command-bar-hints";
import { CommandBarResults } from "./command-bar-results";

/** Never collapse the results to a sliver, however little room is left. */
const RESULTS_PANEL_MIN_HEIGHT = 180;
/** Breathing room between the panel's bottom edge and the viewport's. */
const RESULTS_PANEL_VIEWPORT_MARGIN = 24;

/**
 * Where this palette is mounted.
 *
 * `dialog` is the one Cmd+K raises over the page. `inline` is the one the
 * project home sets in the middle of the page, at hero size, always there.
 */
export type CommandPaletteSurface = "dialog" | "inline";

/**
 * The palette: everything the command bar DOES, with nothing about where it
 * sits.
 *
 * Extracted from `CommandBar` so the home page can mount the same thing
 * without a dialog around it. A second field with its own search, its own
 * ranking and its own idea of what Enter means would be two products in one
 * app: the results would diverge the first time either side was touched, and
 * the reader would have to learn which box did what.
 *
 * The surface changes presentation only. The dialog flows its results inside
 * itself and can afford rotating tips; the inline one overlays its results on
 * the page, so opening them never pushes the rest of the home down.
 *
 * Spec: specs/langy/langy-command-bar-activation.feature,
 *       specs/home/langy-home.feature
 */
export function CommandPalette({
  surface,
  active,
  query,
  setQuery,
  onDone,
  inputRef: providedInputRef,
  placeholder,
  onFocus,
  onBlur,
  onHandoffStateChange,
}: {
  surface: CommandPaletteSurface;
  /**
   * Whether the palette is the thing the reader is using right now. The dialog
   * passes its open state, the inline field whether it holds focus. Selection
   * and Langy mode reset when this goes false, so the palette is never resumed
   * halfway through something.
   */
  active: boolean;
  query: string;
  setQuery: (query: string) => void;
  /**
   * The palette has finished and its surface should stand down. The dialog
   * closes; the inline field clears itself.
   */
  onDone: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Told when a hand-off to Langy starts, so a surface can animate its exit. */
  onHandoffStateChange?: (exiting: boolean) => void;
}) {
  const inline = surface === "inline";
  const host = useNavigationHost();

  /**
   * The inline results panel hangs off the bottom of the ask field, so how
   * much room it has depends entirely on where that field sits — which moves
   * with the viewport. Measured rather than guessed at: a fixed `vh` cap that
   * looks right on a laptop still runs off the bottom of a short window.
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!inline || !active) return;
    const measure = () => {
      const node = panelRef.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top;
      setPanelMaxHeight(
        Math.max(
          RESULTS_PANEL_MIN_HEIGHT,
          window.innerHeight - top - RESULTS_PANEL_VIEWPORT_MARGIN,
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    // Capture: the page scrolls under the field, and the panel travels with it.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [inline, active]);

  /**
   * The home's ask field and Langy's own panel are two ways to say the same
   * thing, and offering both at once is the page talking over itself. While
   * the field is in use, a minimised Langy stands down — the peek sinks away
   * on its own close animation rather than sitting under the results.
   */
  const langy = host.langy();
  const setHomeAskOpen = langy?.setHomeAskOpen;
  useEffect(() => {
    if (!inline || !setHomeAskOpen) return;
    setHomeAskOpen(active);
    return () => setHomeAskOpen(false);
  }, [inline, active, setHomeAskOpen]);
  const currentUserId = host.currentUser()?.id;
  // The one workspace graph the chrome already resolved. Reading it off the
  // host is what keeps the palette's project list, the switcher's and the
  // sidebar's the same list — and it never triggers a redirect, because the
  // host answers with what has been read rather than reading for itself.
  const project = host.project();
  const organizations = host.organizations();
  const openDrawer = host.openDrawer.bind(host);
  const deployment = host.deployment();
  const { setTheme } = useTheme();
  const { idResult, searchResults, isLoading: searchLoading } = useCommandSearch(query, active);
  const { groupedItems, addRecentItem } = useRecentItems();

  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const inputRef = providedInputRef ?? fallbackInputRef;
  const resultsRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Langy activation. Gated on the grant that STARTS a turn, not the one that
  // opens the panel: the hand-off queues a prompt that auto-sends, so offering
  // it to someone holding only `langy:view` would be inviting them into a 403.
  // The host answers `null` for a reader who may not, which is that gate.
  const langyEnabled = !!langy;
  const askLangy = langy?.ask;
  const reduceMotion = useReducedMotion();
  const [langyMode, setLangyMode] = useState(false);
  const [langyExiting, setLangyExiting] = useState(false);
  const handoffTimerRef = useRef<number | null>(null);
  const handoffInFlightRef = useRef(false);

  useEffect(() => {
    onHandoffStateChange?.(langyExiting);
  }, [langyExiting, onHandoffStateChange]);

  // Detect platform for keyboard hints
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  const filteredCommands = useFilteredCommands(
    query,
    deployment.isSaaS,
    project?.id,
    deployment.isDevelopment,
  );
  const filteredProjects = useFilteredProjects(query, organizations, project?.slug, currentUserId);

  const {
    allItems,
    recentItemsLimited,
    searchInTracesItem,
    searchInDocsItem,
    easterEggItem,
    askLangyItem,
  } = useCommandBarItems(
    query,
    filteredCommands,
    filteredProjects,
    searchResults,
    idResult,
    groupedItems,
    project?.slug,
    langyEnabled,
  );

  const { triggerEffect } = useEasterEggEffects();

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allItems.length, query]);

  useScrollIntoView(selectedIndex, resultsRef);

  // The dialog takes focus the moment it opens. The inline field must NOT: it
  // is on the page at load, and a page that grabs the caret on arrival has
  // taken the keyboard from someone who was about to scroll.
  useAutoFocusInput(!inline && active, inputRef);

  const enterLangyMode = useCallback(() => {
    if (!langyEnabled) return;
    handoffInFlightRef.current = false;
    setLangyExiting(false);
    setLangyMode(true);
  }, [langyEnabled]);

  // Hand the typed question to Langy: the panel opens FIRST and auto-sends,
  // then this surface dissolves over its entrance. Reduced motion keeps the
  // same state ordering but closes synchronously, with no decorative overlap.
  // Shared by Enter in Langy mode and by selecting a non-empty "Ask Langy"
  // result — the same single gesture from two doors.
  const handOffToLangy = useCallback(() => {
    if (handoffInFlightRef.current || !askLangy) return;
    handoffInFlightRef.current = true;
    handoffTimerRef.current = beginLangyHandoff({
      prompt: query,
      askLangy,
      closeCommandBar: onDone,
      reducedMotion: reduceMotion,
      setExiting: setLangyExiting,
    });
  }, [query, askLangy, onDone, reduceMotion]);

  const handleSelect = useCallback(
    (item: ListItem, newTab = false) => {
      // The surface is already dissolving into Langy; nothing else may fire.
      if (handoffInFlightRef.current) return;

      const projectSlug = project?.slug ?? "";
      const ctx = { go: (to: string) => host.navigate(to), newTab, close: onDone };

      if (item.type === "command") {
        const cmd = item.data;

        // Ask Langy doesn't navigate. A typed question is already the
        // message, so selecting the row hands it straight to the panel — one
        // Enter, no compose stop in between. Only an empty bar turns the
        // field into Langy's own input first, because there is nothing to
        // send yet.
        if (cmd.id === "action-ask-langy") {
          if (query.trim()) {
            handOffToLangy();
          } else {
            enterLangyMode();
          }
          return;
        }

        if (cmd.externalUrl) {
          window.open(cmd.externalUrl, "_blank", "noopener,noreferrer");
          onDone();
          return;
        }

        if (cmd.id === "action-open-chat") {
          // The bubble is the deployment's, and the host is what knows whether
          // there is one: a deployment with none never lists this command, so
          // reaching it at all means the host has a bubble to open.
          host.supportChat()?.open();
          onDone();
          return;
        }

        if (cmd.id === "action-theme-light") {
          setTheme("light");
          onDone();
          return;
        }
        if (cmd.id === "action-theme-dark") {
          setTheme("dark");
          onDone();
          return;
        }
        if (cmd.id === "action-theme-system") {
          setTheme("system");
          onDone();
          return;
        }

        if (cmd.id.startsWith("easter-")) {
          const egg = findEasterEgg(query);
          if (egg) {
            triggerEffect(egg);
            if (!egg.keepOpen) {
              onDone();
            }
          }
          return;
        }

        handleCommandSelect(cmd, projectSlug, ctx, addRecentItem, openDrawer);
      } else if (item.type === "search") {
        handleSearchResultSelect(item.data, projectSlug, ctx, addRecentItem, openDrawer);
      } else if (item.type === "recent") {
        handleRecentItemSelect(item.data, ctx, addRecentItem, openDrawer);
      } else if (item.type === "project") {
        handleProjectSelect(item.data, ctx, addRecentItem);
      }
    },
    [
      project?.slug,
      host,
      onDone,
      openDrawer,
      addRecentItem,
      setTheme,
      query,
      triggerEffect,
      enterLangyMode,
      handOffToLangy,
    ],
  );

  // Reset Langy mode whenever the palette stands down, so it never resumes
  // mid-transition and the next visit lands on the normal command view. A
  // pending handoff timer never outlives the stand-down either — a timer left
  // running could close a later surface — but its close still RUNS, now: the
  // panel's composer takes focus during the handoff overlap, which blurs an
  // inline field and deactivates it before the timer fires, and skipping the
  // close there would leave the field holding the question it already sent.
  // `onDone` is idempotent on every surface, so the dialog path (already
  // closed when this runs) is unaffected.
  useEffect(() => {
    if (!active) {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
        if (handoffInFlightRef.current) onDone();
      }
      handoffInFlightRef.current = false;
      setLangyMode(false);
      setLangyExiting(false);
    }
  }, [active, onDone]);

  useEffect(
    () => () => {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
      }
    },
    [],
  );

  // Escape / Backspace-on-empty in Langy mode — back to normal command mode.
  const exitLangyMode = useCallback(() => {
    handoffInFlightRef.current = false;
    setLangyMode(false);
    setLangyExiting(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef]);

  const handleCopyLink = useCallback(() => {
    const item = allItems[selectedIndex];
    if (!item) return;

    let path = "";
    const projectSlug = project?.slug ?? "";

    if (item.type === "command" && item.data.path) {
      path = item.data.path.replace("[project]", projectSlug);
    } else if (item.type === "search") {
      path = item.data.path;
    } else if (item.type === "recent") {
      path = item.data.path;
    } else if (item.type === "project") {
      path = `/${item.data.slug}`;
    }

    if (path) {
      const url = `${window.location.origin}${path}`;
      void navigator.clipboard.writeText(url);
    }
  }, [allItems, selectedIndex, project?.slug]);

  // Keyboard navigation. Tab is the one addition: it takes whatever is typed
  // straight to Langy. Reaching the assistant by arrowing to the bottom of a
  // list of places to go made the more capable of the two routes read as the
  // fallback after navigation failed to match.
  const handleKeyDown = useCommandBarKeyboard(
    allItems,
    selectedIndex,
    setSelectedIndex,
    handleSelect,
    handleCopyLink,
    isMac,
    langyEnabled ? enterLangyMode : undefined,
  );

  if (langyMode) {
    return (
      <CommandBarLangyMode
        query={query}
        onQueryChange={setQuery}
        onSubmit={handOffToLangy}
        onExit={exitLangyMode}
        exiting={langyExiting}
        mark={langy?.mark}
      />
    );
  }

  const results = (
    <CommandBarResults
      ref={resultsRef}
      query={query}
      allItems={allItems}
      selectedIndex={selectedIndex}
      onSelect={handleSelect}
      onMouseEnter={setSelectedIndex}
      filteredNavigation={filteredCommands.navigation}
      filteredActions={filteredCommands.actions}
      filteredSupport={filteredCommands.support}
      filteredTheme={filteredCommands.theme}
      filteredPage={filteredCommands.page}
      searchResults={searchResults}
      filteredProjects={filteredProjects}
      searchInTracesItem={searchInTracesItem}
      searchInDocsItem={searchInDocsItem}
      idResult={idResult}
      recentItemsLimited={recentItemsLimited}
      easterEggItem={easterEggItem}
      askLangyItem={askLangyItem}
      isLoading={searchLoading}
      // The dialog holds the field and the list in one card, so the list
      // draws the line between them. The inline panel is its own box under
      // the field, and already has an edge there.
      showTopDivider={!inline}
    />
  );

  return (
    <>
      <CommandBarInput
        inputRef={inputRef}
        query={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        isLoading={searchLoading}
        placeholder={placeholder}
        onFocus={onFocus}
        onBlur={onBlur}
        size={inline ? "hero" : "dialog"}
      />

      {inline ? (
        active ? (
          // Overlaid, never in the flow: the home's results are a temporary
          // layer over the page, so opening them cannot push the figures and
          // recent work down and closing them cannot pull them back up.
          <Box
            ref={panelRef}
            position="absolute"
            top="calc(100% + 8px)"
            left={0}
            right={0}
            zIndex={20}
            background={{ base: "bg.panel/50", _dark: "bg.panel/70" }}
            backdropFilter="blur(20px)"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="16px"
            boxShadow="0 2px 8px rgba(20, 20, 23, 0.08), 0 24px 70px -20px rgba(20, 20, 23, 0.35)"
            overflow="hidden"
            paddingTop={2}
            // Capped to the room actually left below the field, so a long list
            // scrolls inside the panel instead of running off the page where
            // its last rows — and the footer's shortcuts — cannot be reached.
            {...(panelMaxHeight !== null ? { maxHeight: `${panelMaxHeight}px` } : {})}
            display="flex"
            flexDirection="column"
          >
            {/* The list is the part that scrolls; the footer stays put, since
                a legend you have to scroll to reach teaches nobody anything. */}
            <Box overflowY="auto" minHeight={0} flex="1 1 auto">
              {results}
            </Box>
            <Box flexShrink={0}>
              <CommandBarFooter isMac={isMac} />
            </Box>
          </Box>
        ) : null
      ) : (
        <>
          {results}
          <HintsSection />
          <CommandBarFooter isMac={isMac} />
        </>
      )}
    </>
  );
}
