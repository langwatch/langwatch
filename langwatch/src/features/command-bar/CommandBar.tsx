import { subDays } from "date-fns";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { useShowLangy } from "~/features/langy/hooks/useShowLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useSession } from "~/utils/auth-client";
import type { NextRouter } from "~/utils/compat/next-router";
import { useRouter } from "~/utils/compat/next-router";
import { useCommandBar } from "./CommandBarContext";
import { CommandBarFooter } from "./components/CommandBarFooter";
import { CommandBarInput } from "./components/CommandBarInput";
import { CommandBarLangyMode } from "./components/CommandBarLangyMode";
import { CommandBarResults } from "./components/CommandBarResults";
import { HintsSection } from "./components/HintsSection";
import { COMMAND_BAR_MAX_WIDTH, COMMAND_BAR_TOP_MARGIN } from "./constants";
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
      void router.push(
        { query: { ...router.query, view: "list" } },
        undefined,
        { shallow: true },
      );
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

/**
 * CommandBar component - global Cmd+K command palette.
 */
export function CommandBar() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isOpen, close, query, setQuery } = useCommandBar();
  // CommandBar is mounted globally via CommandBarProvider in _app.tsx and
  // is rendered on every route. It only consumes `project` + `organizations`
  // to show context — it must NOT trigger the org-onboarding bouncer or it
  // will race with page-level mutations like the invite-accept flow (bug
  // 33 in iter 47 of the BetterAuth migration audit). Belt-and-suspenders
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
  } = useCommandSearch(query, isOpen);
  const { groupedItems, addRecentItem } = useRecentItems();

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Langy activation: whether to offer "Ask Langy" (same gate as the panel), the
  // store hand-off, and the local Langy-mode state the bar flips into on activation.
  const langyEnabled = useShowLangy();
  const askLangy = useLangyStore((s) => s.askLangy);
  const reduceMotion = useReducedMotion();
  const [langyMode, setLangyMode] = useState(false);
  const [langyExiting, setLangyExiting] = useState(false);
  const handoffTimerRef = useRef<number | null>(null);
  const handoffInFlightRef = useRef(false);

  // Detect platform for keyboard hints
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // Extract filtered commands and projects using hooks
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

  // Build flat list of all items for keyboard navigation
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

  // Easter egg effects
  const { triggerEffect } = useEasterEggEffects();

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allItems.length, query]);

  // Scroll selected item into view
  useScrollIntoView(selectedIndex, resultsRef);

  // Focus input when dialog opens
  useAutoFocusInput(isOpen, inputRef);

  // Handle item selection - delegates to focused handlers
  const handleSelect = useCallback(
    (item: ListItem, newTab = false) => {
      const projectSlug = project?.slug ?? "";
      const ctx = { router, newTab, close };

      if (item.type === "command") {
        const cmd = item.data;

        // Ask Langy doesn't navigate — it focuses the bar into Langy's own
        // input mode. Enter from there performs the panel handoff.
        if (cmd.id === "action-ask-langy") {
          handoffInFlightRef.current = false;
          setLangyExiting(false);
          setLangyMode(true);
          return;
        }

        // Handle external URLs
        if (cmd.externalUrl) {
          window.open(cmd.externalUrl, "_blank", "noopener,noreferrer");
          close();
          return;
        }

        // Handle Open Chat (Crisp)
        if (cmd.id === "action-open-chat") {
          const crisp = (
            window as unknown as {
              $crisp?: { push: (args: unknown[]) => void };
            }
          ).$crisp;
          crisp?.push(["do", "chat:show"]);
          crisp?.push(["do", "chat:toggle"]);
          close();
          return;
        }

        // Handle theme switching
        if (cmd.id === "action-theme-light") {
          setTheme("light");
          close();
          return;
        }
        if (cmd.id === "action-theme-dark") {
          setTheme("dark");
          close();
          return;
        }
        if (cmd.id === "action-theme-system") {
          setTheme("system");
          close();
          return;
        }

        // Handle easter eggs
        if (cmd.id.startsWith("easter-")) {
          const egg = findEasterEgg(query);
          if (egg) {
            triggerEffect(egg);
            if (!egg.keepOpen) {
              close();
            }
          }
          return;
        }

        // Handle page-specific commands (traces page)
        if (cmd.id.startsWith("page-traces-")) {
          handleTracesPageCommand(cmd.id, router, close);
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
      close,
      openDrawer,
      addRecentItem,
      setTheme,
      query,
      triggerEffect,
    ],
  );

  // Reset Langy mode whenever the bar closes, so it never reopens mid-transition
  // and the next Cmd+K lands on the normal command view. A pending handoff is
  // cancelled as well; otherwise a fast Escape/unmount could close a later bar.
  useEffect(() => {
    if (!isOpen) {
      if (handoffTimerRef.current !== null) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
      handoffInFlightRef.current = false;
      setLangyMode(false);
      setLangyExiting(false);
    }
  }, [isOpen]);

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
  }, []);

  // Enter in Langy mode — open the panel FIRST, then let this surface dissolve over
  // the panel's entrance. Reduced motion keeps the same state ordering but
  // closes synchronously, with no decorative overlap.
  const submitLangyMode = useCallback(() => {
    if (handoffInFlightRef.current) return;
    handoffInFlightRef.current = true;
    handoffTimerRef.current = beginLangyHandoff({
      prompt: query,
      askLangy,
      closeCommandBar: close,
      reducedMotion: reduceMotion,
      setExiting: setLangyExiting,
    });
  }, [query, askLangy, close, reduceMotion]);

  // Copy link to clipboard
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

  // Keyboard navigation
  const handleKeyDown = useCommandBarKeyboard(
    allItems,
    selectedIndex,
    setSelectedIndex,
    handleSelect,
    handleCopyLink,
    isMac,
  );

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && close()}
      placement="top"
      motionPreset="slide-in-top"
    >
      <Dialog.Content
        background="bg.surface/92"
        width={{ base: "calc(100vw - 24px)", md: COMMAND_BAR_MAX_WIDTH }}
        maxWidth={COMMAND_BAR_MAX_WIDTH}
        marginTop={{ base: "8vh", md: COMMAND_BAR_TOP_MARGIN }}
        padding={0}
        overflow="hidden"
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius={{ base: "18px", md: "20px" }}
        boxShadow="0 2px 8px rgba(20, 20, 23, 0.08), 0 24px 70px -20px rgba(20, 20, 23, 0.35)"
        backdropFilter="blur(20px) saturate(1.15)"
        backdropProps={{ backdropFilter: "blur(12px) saturate(1.05)" }}
        data-langy-handoff={langyExiting ? "exiting" : undefined}
        style={{
          opacity: langyExiting ? 0 : 1,
          transform: langyExiting
            ? "translate3d(18px, 4px, 0) scale(0.985)"
            : undefined,
          filter: langyExiting ? "blur(2px)" : undefined,
          transition: reduceMotion
            ? undefined
            : "opacity 160ms ease, transform 220ms cubic-bezier(0.32, 0.72, 0, 1), filter 160ms ease",
        }}
      >
        {langyMode ? (
          <CommandBarLangyMode
            query={query}
            onQueryChange={setQuery}
            onSubmit={submitLangyMode}
            onExit={exitLangyMode}
            exiting={langyExiting}
          />
        ) : (
          <>
            <CommandBarInput
              inputRef={inputRef}
              query={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              isLoading={searchLoading}
            />

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
            />

            <HintsSection />

            <CommandBarFooter isMac={isMac} />
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
