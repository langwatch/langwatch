import { useRouter } from "next/router";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { subDays } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { useCommandBar } from "./CommandBarContext";
import { useCommandSearch } from "./useCommandSearch";
import { useRecentItems } from "./useRecentItems";
import type { ListItem } from "./getIconInfo";
import { COMMAND_BAR_TOP_MARGIN, COMMAND_BAR_MAX_WIDTH } from "./constants";
import { HintsSection } from "./components/HintsSection";
import { CommandBarInput } from "./components/CommandBarInput";
import { CommandBarResults } from "./components/CommandBarResults";
import { CommandBarFooter } from "./components/CommandBarFooter";
import {
  useFilteredCommands,
  useFilteredProjects,
  useCommandBarItems,
  useCommandBarKeyboard,
  useScrollIntoView,
  useAutoFocusInput,
} from "./hooks";
import {
  handleCommandSelect,
  handleSearchResultSelect,
  handleRecentItemSelect,
  handleProjectSelect,
} from "./selectHandlers";
import { findEasterEgg } from "./easterEggs";
import { useEasterEggEffects } from "./effects/useEasterEggEffects";
import type { NextRouter } from "next/router";

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
  const { project, organizations } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const publicEnv = usePublicEnv();
  const { setTheme } = useTheme();
  const {
    idResult,
    searchResults,
    isLoading: searchLoading,
  } = useCommandSearch(query);
  const { groupedItems, addRecentItem } = useRecentItems();

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Detect platform for keyboard hints
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // Extract filtered commands and projects using hooks
  const filteredCommands = useFilteredCommands(query, publicEnv.data?.IS_SAAS);
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
  } = useCommandBarItems(
    query,
    filteredCommands,
    filteredProjects,
    searchResults,
    idResult,
    groupedItems,
    project?.slug,
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
        width={COMMAND_BAR_MAX_WIDTH}
        maxWidth="90vw"
        marginTop={COMMAND_BAR_TOP_MARGIN}
        padding={0}
        overflow="hidden"
        borderRadius="xl"
      >
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
          isLoading={searchLoading}
        />

        <HintsSection />

        <CommandBarFooter isMac={isMac} />
      </Dialog.Content>
    </Dialog.Root>
  );
}
