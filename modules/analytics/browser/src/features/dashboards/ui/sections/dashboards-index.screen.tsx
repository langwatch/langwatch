/**
 * `/[project]/dashboards`: the All dashboards page. The Dashboards tab lists
 * every board in the project, searchable and sortable, each row with a star,
 * a menu and a link; the Templates tab is the library at its own URL.
 */

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { useSavedDashboards, type SavedBoard } from "../../behavior/use-saved-dashboards.ts";
import {
  DASHBOARD_SORT_LABELS,
  DASHBOARD_SORTS,
  DEFAULT_DASHBOARD_SORT,
  type DashboardSort,
  filterDashboards,
  sortDashboards,
} from "../../model/all-dashboards.ts";
import { dashboardsPath, dashboardTemplatesPath } from "../../model/boards.ts";
import { AllDashboardsRow } from "../blocks/all-dashboards-row.tsx";
import { DashboardsTabs } from "../blocks/dashboards-tabs.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

function AllDashboards() {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const favourites = useFavourites();
  const fromTemplate = useBoardFromTemplate();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DashboardSort>(DEFAULT_DASHBOARD_SORT);
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<SavedBoard | undefined>();
  const { projectSlug } = saved;
  const boardNames = saved.boards.map(({ name }) => name);

  const shown = sortDashboards({
    boards: filterDashboards({ boards: saved.boards, search }),
    sort,
  });

  const confirmDelete = () => {
    if (!pendingDelete) return;
    saved.deleteBoard({ dashboardId: pendingDelete.id, onDeleted: () => setPendingDelete(void 0) });
  };

  const renderList = () => {
    if (saved.loadError) {
      return (
        <HandledErrorAlert
          error={saved.loadError}
          fallbackTitle="Your dashboards could not be loaded"
        />
      );
    }
    if (saved.isLoading) return <Spinner size="sm" />;
    if (saved.boards.length === 0) {
      return (
        <EmptyState
          templatesHref={dashboardTemplatesPath({ projectSlug })}
          onNewBoard={saved.createBoard}
          isCreating={saved.isCreating}
        />
      );
    }
    if (shown.length === 0) {
      return (
        <Text fontSize="14px" color="fg.muted" paddingY={8}>
          No dashboard matches your search.
        </Text>
      );
    }
    return (
      <VStack
        as="ul"
        align="stretch"
        gap={0}
        margin={0}
        padding={0}
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        {shown.map((board) => (
          <AllDashboardsRow
            key={board.id}
            board={board}
            href={dashboardsPath({ projectSlug, dashboardId: board.id })}
            currentUserId={host.userId()}
            actions={{
              isRenaming: renamingId === board.id,
              onRenameStart: () => setRenamingId(board.id),
              onRenameCommit: (name) => {
                setRenamingId(void 0);
                saved.renameBoard({ dashboardId: board.id, name });
              },
              onRenameCancel: () => setRenamingId(void 0),
              onToggleStar: () =>
                favourites.toggleStar({ dashboardId: board.id, isStarred: board.isStarred }),
              onDuplicate: () =>
                void fromTemplate.duplicateBoard({ board, existingNames: boardNames }),
              onDelete: () => setPendingDelete(board),
            }}
          />
        ))}
      </VStack>
    );
  };

  return (
    <VStack
      align="stretch"
      gap={5}
      width="full"
      maxWidth="1200px"
      marginX="auto"
      paddingX={{ base: 4, md: 8 }}
      paddingY={{ base: 5, md: 7 }}
    >
      <HStack align="start" justify="space-between" gap={4} flexWrap="wrap">
        <DashboardsTabs projectSlug={projectSlug} active="dashboards" />
        <Button
          size="sm"
          colorPalette="teal"
          gap={1.5}
          loading={saved.isCreating}
          onClick={saved.createBoard}
        >
          <Plus size={15} strokeWidth={2.2} /> New dashboard
        </Button>
      </HStack>

      <HStack gap={3} flexWrap="wrap">
        <Box display="grid" flex="1 1 240px" maxWidth={{ base: "full", md: "360px" }}>
          <SearchInput
            size="sm"
            aria-label="Search dashboards"
            placeholder="Search dashboards by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Box>
        <SortMenu sort={sort} onChange={setSort} />
      </HStack>

      {renderList()}

      <ConfirmDialog
        open={pendingDelete !== void 0}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDelete(void 0);
        }}
        title="Delete dashboard"
        message={`Delete "${pendingDelete?.name ?? ""}" and every widget on it? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={saved.isDeleting}
        onConfirm={confirmDelete}
      />
    </VStack>
  );
}

function SortMenu({
  sort,
  onChange,
}: {
  sort: DashboardSort;
  onChange: (sort: DashboardSort) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="sm"
          variant="outline"
          gap={1.5}
          aria-label={`Sort: ${DASHBOARD_SORT_LABELS[sort]}`}
        >
          {DASHBOARD_SORT_LABELS[sort]} <ChevronDown size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.RadioItemGroup
          value={sort}
          onValueChange={({ value }) => {
            const picked = DASHBOARD_SORTS.find((option) => option === value);
            if (picked) onChange(picked);
          }}
        >
          {DASHBOARD_SORTS.map((option) => (
            <Menu.RadioItem key={option} value={option}>
              {DASHBOARD_SORT_LABELS[option]}
            </Menu.RadioItem>
          ))}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}

function EmptyState({
  templatesHref,
  onNewBoard,
  isCreating,
}: {
  templatesHref: string;
  onNewBoard: () => void;
  isCreating: boolean;
}) {
  const host = useAnalyticsHost();
  return (
    <VStack gap={3} paddingY={16} textAlign="center">
      <Text fontSize="15px" fontWeight="medium" color="fg">
        No dashboards yet
      </Text>
      <HStack gap={3}>
        <Button size="sm" variant="outline" onClick={() => host.navigate(templatesHref)}>
          Start from a template
        </Button>
        <Button size="sm" colorPalette="teal" loading={isCreating} onClick={onNewBoard}>
          New blank dashboard
        </Button>
      </HStack>
    </VStack>
  );
}

export default function DashboardsIndexScreen() {
  return (
    <DashboardsGate>
      <AllDashboards />
    </DashboardsGate>
  );
}
