import { Box } from "@chakra-ui/react";
import { subDays } from "date-fns";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useSession } from "~/utils/auth-client";
import type { NextRouter } from "~/utils/compat/next-router";
import { useRouter } from "~/utils/compat/next-router";
import { CommandBarFooter } from "./components/CommandBarFooter";
import { CommandBarInput } from "./components/CommandBarInput";
import { CommandBarLangyMode } from "./components/CommandBarLangyMode";
import { CommandBarResults } from "./components/CommandBarResults";
import { HintsSection } from "./components/HintsSection";
import { findEasterEgg } from "./easterEggs";
import { useEasterEggEffects } from "./effects/useEasterEggEffects";
import type { ListItem } from "./getIconInfo";
import {
  useAutoFocusInput,
  useCommandBarItems,
  useCommandBarKeyboard,
  useFilteredCommands,
  useFilteredProjects,
  useScrollIntoView,
} from "./hooks";
import { beginLangyHandoff } from "./langyHandoff";
import {
  handleCommandSelect,
  handleProjectSelect,
  handleRecentItemSelect,
  handleSearchResultSelect,
} from "./selectHandlers";
import { useCommandSearch } from "./useCommandSearch";
import { useRecentItems } from "./useRecentItems";

/**
 * Handle page-specific commands for the traces page.
 */
function handleTracesPageCommand(
  commandId: string,
  router: NextRouter,
  close: () => void,
) {
  switch (commandId) {
    case "page-traces-view-list":
      void router.push({ query: { ...router.query, view: "list" } }, undefined, {
        shallow: true,
      });
      close();
      break;
    case "page-traces-view-table":
      void router.push(
        { query: { ...router.query, view: "table" } },
        undefined,
        { shallow: true },
      );
      close();
      break;
    case "page-traces-date-7d": {
      const end7d = new Date();
      const start7d = subDays(end7d, 6);
      void router.push(
        {
          query: {
            ...router.query,
            startDate: start7d.getTime().toString(),
            endDate: end7d.getTime().toString(),
          },
        },
        undefined,
        { shallow: true },
      );
      close();
      break;
    }
    case "page-traces-date-30d": {
      const end30d = new Date();
      const start30d = subDays(end30d, 29);
      void router.push(
        {
          query: {
            ...router.query,
            startDate: start30d.getTime().toString(),
            endDate: end30d.getTime().toString(),
          },
        },
        undefined,
        { shallow: true },
      );
      close();
      break;
    }
    case "page-traces-date-today": {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      void router.push(
        {
          query: {
            ...router.query,
            startDate: startOfDay.getTime().toString(),
            endDate: today.getTime().toString(),
          },
        },
        undefined,
        { shallow: true },
      );
      close();
      break;
    }
    case "page-traces-clear-filters":
      // Keep only project and view params, remove filters
      void router.push(
        {
          pathname: router.pathname,
          query: {
            project: router.query.project,
            ...(router.query.view ? { view: router.query.view } : {}),
          },
        },
        undefined,
        { shallow: true },
      );
      close();
      break;
  }
}

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
  const router = useRouter();

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
  const setHomeAskOpen = useLangyStore((s) => s.setHomeAskOpen);
  useEffect(() => {
    if (!inline) return;
    setHomeAskOpen(active);
    return () => setHomeAskOpen(false);
  }, [inline, active, setHomeAskOpen]);
  const { data: session } = useSession();
  // Mounted on every route: this only consumes `project` + `organizations` to
  // show context and must NOT trigger the org-onboarding bouncer, or it races
  // with page-level mutations like the invite-accept flow. Belt-and-suspenders
  // alongside the noOrgBouncerRoutes route exemption.
  const { project, organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { openDrawer } = useDrawer();
  const publicEnv = usePublicEnv();
  const { setTheme } = useTheme();
  const {
    idResult,
    searchResults,
    isLoading: searchLoading,
  } = useCommandSearch(query, active);
  const { groupedItems, addRecentItem } = useRecentItems();

  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const inputRef = providedInputRef ?? fallbackInputRef;
  const resultsRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Langy activation. Gated on the grant that STARTS a turn, not the one that
  // opens the panel: the hand-off queues a prompt that auto-sends, so offering
  // it to someone holding only `langy:view` would be inviting them into a 403.
  const langyEnabled = useCanAskLangy();
  const askLangy = useLangyStore((s) => s.askLangy);
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
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  const filteredCommands = useFilteredCommands(
    query,
    publicEnv.data?.IS_SAAS,
    project?.id,
    publicEnv.data?.NODE_ENV === "development",
  );
  const filteredProjects = useFilteredProjects(
    query,
    organizations,
    project?.slug,
    session?.user?.id,
  );

  const {
    allItems,
    recentItemsLimited,
    searchInTracesItem,
    searchInDocsItem,
    easterEggItem,
    askLangyItem,
    askLangySuggestionItems,
  } = useCommandBarItems(
    query,
    filteredCommands,
    filteredProjects,
    searchResults,
    idResult,
    groupedItems,
    project?.slug,
    langyEnabled,
    askLangy,
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

  const handleSelect = useCallback(
    (item: ListItem, newTab = false) => {
      const projectSlug = project?.slug ?? "";
      const ctx = { router, newTab, close: onDone };

      if (item.type === "command") {
        const cmd = item.data;

        // Ask Langy doesn't navigate — it turns the field into Langy's own
        // input. Enter from there performs the panel handoff.
        if (cmd.id === "action-ask-langy") {
          enterLangyMode();
          return;
        }

        if (cmd.externalUrl) {
          window.open(cmd.externalUrl, "_blank", "noopener,noreferrer");
          onDone();
          return;
        }

        if (cmd.id === "action-open-chat") {
          const crisp = (
            window as unknown as {
              $crisp?: { push: (args: unknown[]) => void };
            }
          ).$crisp;
          crisp?.push(["do", "chat:show"]);
          crisp?.push(["do", "chat:toggle"]);
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

        if (cmd.id.startsWith("page-traces-")) {
          handleTracesPageCommand(cmd.id, router, onDone);
          return;
        }

        // Action commands (e.g. the Ask-Langy getting-started asks) run their
        // own handler and close the bar — no navigation.
        if (cmd.action) {
          cmd.action();
          onDone();
          return;
        }

        handleCommandSelect(cmd, projectSlug, ctx, addRecentItem, openDrawer);
      } else if (item.type === "search") {
        handleSearchResultSelect(
          item.data,
          projectSlug,
          ctx,
          addRecentItem,
          openDrawer,
        );
      } else if (item.type === "recent") {
        handleRecentItemSelect(item.data, ctx, addRecentItem, openDrawer);
      } else if (item.type === "project") {
        handleProjectSelect(item.data, ctx, addRecentItem);
      }
    },
    [
      project?.slug,
      router,
      onDone,
      openDrawer,
      addRecentItem,
      setTheme,
      query,
      triggerEffect,
      enterLangyMode,
    ],
  );

  // Reset Langy mode whenever the palette stands down, so it never resumes
  // mid-transition and the next visit lands on the normal command view. A
  // pending handoff is cancelled too; otherwise a fast Escape could close a
  // later surface.
  useEffect(() => {
    if (!active) {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
      handoffInFlightRef.current = false;
      setLangyMode(false);
      setLangyExiting(false);
    }
  }, [active]);

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

  // Enter in Langy mode — open the panel FIRST, then let this surface dissolve
  // over the panel's entrance. Reduced motion keeps the same state ordering but
  // closes synchronously, with no decorative overlap.
  const submitLangyMode = useCallback(() => {
    if (handoffInFlightRef.current) return;
    handoffInFlightRef.current = true;
    handoffTimerRef.current = beginLangyHandoff({
      prompt: query,
      askLangy,
      closeCommandBar: onDone,
      reducedMotion: reduceMotion,
      setExiting: setLangyExiting,
    });
  }, [query, askLangy, onDone, reduceMotion]);

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
        onSubmit={submitLangyMode}
        onExit={exitLangyMode}
        exiting={langyExiting}
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
      askLangySuggestionItems={askLangySuggestionItems}
      isLoading={searchLoading}
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
            {...(panelMaxHeight !== null
              ? { maxHeight: `${panelMaxHeight}px` }
              : {})}
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
