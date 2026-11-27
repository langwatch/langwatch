/**
 * `/dashboards`, the organization's Dashboards library (ADR-002): one table of every board the
 * member can see, searched and filtered; the one place a board moves between products. A board
 * opens at `/dashboards/<id>`; `?new=1` opens the create dialog. dashboards-organization-area
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import type { DashboardHomeProduct, DashboardScope } from "@langwatch/dashboard-contract";
import { FilterChips } from "@langwatch/design-system/filter-chips";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Button, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { TableToolbar } from "@langwatch/design-system/table-toolbar";
import { HandledErrorAlert } from "@langwatch/error-views";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { LayoutDashboard, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardReader } from "../../behavior/use-board-access.ts";
import { useLibraryCreateDialog } from "../../behavior/use-library-create-dialog.ts";
import { useLibraryFilters } from "../../behavior/use-library-filters.ts";
import { useOrganizationLibrary } from "../../behavior/use-organization-library.ts";
import {
  LIBRARY_OWNER_CHOICES,
  LIBRARY_SHARING_CHOICES,
  type LibraryOwnerFilter,
} from "../../model/library-filters.ts";
import {
  LIBRARY_HEADER,
  type LibraryBoard,
  namesInProduct,
} from "../../model/organization-library.ts";
import { LIBRARY_COLUMNS } from "../blocks/library-row.tsx";
import { BoardMenuDialogs } from "./board-menu-dialogs.tsx";
import { LibraryBoardRow } from "./library-board-rows.tsx";
import { NewDashboardDialog } from "./new-dashboard-dialog.tsx";

const LIBRARY_DOCS = "https://docs.langwatch.ai/features/dashboards";

export default function DashboardsLibraryScreen() {
  const library = useOrganizationLibrary();
  const [pendingDelete, setPendingDelete] = useState<LibraryBoard | undefined>();
  const [pendingMove, setPendingMove] = useState<LibraryBoard | undefined>();
  const { storeProject } = library;
  // The store project is one where the member may create, so having one is the permission.
  const mayCreate = storeProject !== void 0;
  const createDialog = useLibraryCreateDialog({ mayCreate });

  if (readHandledError(library.loadError)?.code === "dashboards_not_enabled") {
    return <UiPageNotFound />;
  }
  if (library.isLoading) return <UiPageLoading />;

  // A copy goes to the store project too, so with none nothing is copied.
  const duplicates = mayCreate ? { onDuplicate: library.duplicateBoard } : {};
  const newButton = mayCreate ? (
    <Button size="sm" colorPalette="teal" onClick={createDialog.open}>
      <Plus size={14} aria-hidden />
      New dashboard
    </Button>
  ) : null;
  const loadError = library.loadError ? (
    <LoadError error={library.loadError} onRetry={library.retry} />
  ) : null;

  return (
    <Box width="full" maxWidth="1120px" marginX="auto" paddingX={6} paddingY={8}>
      <LibraryHeader action={newButton} />
      <LibraryBody
        boards={library.boards}
        loadError={loadError}
        hasList={library.hasList}
        newButton={newButton}
        handlers={{ ...duplicates, onMove: setPendingMove, onDelete: setPendingDelete }}
      />
      <LibraryDialogs
        library={library}
        isNewDialogOpen={createDialog.isOpen}
        onCloseNewDialog={createDialog.close}
        pendingMove={pendingMove}
        onSettleMove={() => setPendingMove(void 0)}
        pendingDelete={pendingDelete}
        onSettleDelete={() => setPendingDelete(void 0)}
      />
    </Box>
  );
}

/** The table, or why there is none: a failed read with a list held keeps the rows. */
function LibraryBody({
  boards,
  loadError,
  hasList,
  newButton,
  handlers,
}: {
  boards: readonly LibraryBoard[];
  loadError: ReactNode;
  hasList: boolean;
  newButton: ReactNode;
  handlers: BoardHandlers;
}) {
  if (loadError && !hasList) return <>{loadError}</>;
  // An empty list beside a failed store read still says the failure, or creation vanishes unsaid.
  if (boards.length === 0) {
    return (
      <VStack align="stretch" gap={6}>
        {loadError}
        <NoDataInfoBlock
          icon={<LayoutDashboard size={20} />}
          title="No dashboards yet"
          description="Make one for any product. It shows in that product's sidebar."
          primaryAction={newButton}
        />
      </VStack>
    );
  }
  return (
    <VStack align="stretch" gap={4}>
      {loadError}
      <LibraryTable boards={boards} handlers={handlers} />
    </VStack>
  );
}

/** The toolbar's search and filters over the one table of boards. */
function LibraryTable({
  boards,
  handlers,
}: {
  boards: readonly LibraryBoard[];
  handlers: BoardHandlers;
}) {
  const host = useAnalyticsHost();
  const view = useLibraryFilters({ boards, userId: host.userId() });
  const { filters } = view;
  return (
    <VStack align="stretch" gap={3}>
      <TableToolbar
        search={{
          value: filters.search,
          onChange: (search) => view.change({ search }),
          placeholder: "Search dashboards",
          ariaLabel: "Search dashboards",
        }}
        filters={
          <HStack gap={3} wrap="wrap">
            <FilterChips
              groupLabel="Filter dashboards by product"
              value={filters.product}
              items={view.productChips}
              countNoun={{ singular: "dashboard", plural: "dashboards" }}
              colorPalette="teal"
              onChange={(product) =>
                view.change({ product: product as DashboardHomeProduct | "all" })
              }
            />
            <LabelledChoice label="Created by">
              <SegmentedControl
                size="xs"
                aria-label="Created by"
                value={filters.owner}
                items={[...LIBRARY_OWNER_CHOICES]}
                onValueChange={({ value }) =>
                  view.change({ owner: (value ?? "anyone") as LibraryOwnerFilter })
                }
              />
            </LabelledChoice>
            <LabelledChoice label="Shared with">
              <SegmentedControl
                size="xs"
                aria-label="Shared with"
                value={filters.sharing}
                items={[...LIBRARY_SHARING_CHOICES]}
                onValueChange={({ value }) =>
                  view.change({ sharing: (value ?? "any") as DashboardScope | "any" })
                }
              />
            </LabelledChoice>
          </HStack>
        }
        summary={view.summary}
        onClearFilters={view.isFiltered ? view.clear : void 0}
      />
      {view.rows.length === 0 ? (
        <NoDataInfoBlock
          size="line"
          title="No dashboards match these filters"
          action={{ label: "Clear filters", onClick: view.clear }}
          next={[{ kind: "docs", label: "Read about dashboards", href: LIBRARY_DOCS }]}
        />
      ) : (
        <ListTable aria-label="Dashboards" scroll="x" scrollLabel="Dashboards" minWidth="48rem">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.SortHeader
                sorted={view.sort?.column === "name" ? view.sort.direction : false}
                onSort={() => view.sortBy("name")}
              >
                Name
              </ListTable.SortHeader>
              {(["product", "whoSees", "owner"] as const).map((column) => (
                <ListTable.ColumnHeader key={column} width={LIBRARY_COLUMNS[column].width}>
                  {LIBRARY_COLUMNS[column].label}
                </ListTable.ColumnHeader>
              ))}
              <ListTable.SortHeader
                width={LIBRARY_COLUMNS.updated.width}
                sorted={view.sort?.column === "updated" ? view.sort.direction : false}
                onSort={() => view.sortBy("updated")}
              >
                {LIBRARY_COLUMNS.updated.label}
              </ListTable.SortHeader>
              <ListTable.ActionHeader label="Dashboard actions" />
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {view.rows.map((board) => (
              <LibraryBoardRow
                key={board.id}
                board={board}
                {...(handlers.onDuplicate
                  ? { onDuplicate: () => handlers.onDuplicate?.(board) }
                  : {})}
                onMove={() => handlers.onMove(board)}
                onDelete={() => handlers.onDelete(board)}
              />
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </VStack>
  );
}

function LabelledChoice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <HStack gap={2}>
      <Text as="span" textStyle="xs" color="fg.muted" aria-hidden>
        {label}
      </Text>
      {children}
    </HStack>
  );
}

function LibraryHeader({ action }: { action: ReactNode }) {
  return (
    <HStack justify="space-between" align="start" marginBottom={6}>
      <VStack align="start" gap={1}>
        <Heading as="h1" textStyle="pageTitle">
          {LIBRARY_HEADER.title}
        </Heading>
        <Text textStyle="bodySm" color="fg.muted">
          {LIBRARY_HEADER.hint}
        </Text>
      </VStack>
      {action}
    </HStack>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <VStack align="start" gap={2}>
      <HandledErrorAlert error={error} fallbackTitle="Couldn't load your dashboards." />
      <Button size="xs" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </VStack>
  );
}

/** The create and move dialogs and the delete confirmation; the screen owns which is open. */
function LibraryDialogs({
  library,
  isNewDialogOpen,
  onCloseNewDialog,
  pendingMove,
  onSettleMove,
  pendingDelete,
  onSettleDelete,
}: {
  library: ReturnType<typeof useOrganizationLibrary>;
  isNewDialogOpen: boolean;
  onCloseNewDialog: () => void;
  pendingMove: LibraryBoard | undefined;
  onSettleMove: () => void;
  pendingDelete: LibraryBoard | undefined;
  onSettleDelete: () => void;
}) {
  const { organizationName } = useBoardReader();
  const { storeProject } = library;
  return (
    <>
      {isNewDialogOpen && storeProject && (
        <NewDashboardDialog
          takenNamesIn={(product) => namesInProduct({ boards: library.boards, product })}
          projectName={storeProject.name}
          organizationName={organizationName}
          mayShare={library.mayShare}
          projectChoice={{ projects: library.storeProjects, initial: storeProject }}
          isCreating={library.isCreating}
          onCreate={library.createBoard}
          onClose={onCloseNewDialog}
        />
      )}
      <BoardMenuDialogs
        pendingMove={pendingMove}
        onSettleMove={onSettleMove}
        pendingDelete={pendingDelete}
        onSettleDelete={onSettleDelete}
      />
    </>
  );
}

/** The duplicates are unset where there is no store project to copy into. */
type BoardHandlers = {
  onDuplicate?: (board: LibraryBoard) => void;
  onMove: (board: LibraryBoard) => void;
  onDelete: (board: LibraryBoard) => void;
};
