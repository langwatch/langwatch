/**
 * "Dashboards" section: the pinned From LangWatch board, its boards, then the dotted row.
 * No boards and nothing pinned: "No dashboards yet". "Browse templates" only in LLM Ops.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { ProductDashboardsProps } from "@langwatch/analytics-client";
import { SidebarSectionLabel } from "@langwatch/design-system/app-shell";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { LayoutDashboard, LayoutTemplate, Lock, Pin } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardReader } from "../../behavior/use-board-access.ts";
import { useBoardMenuActions } from "../../behavior/use-board-menu-actions.ts";
import { useDraftBoard, useStartDraft } from "../../behavior/use-draft-board.ts";
import { useLibraryBoardEdits } from "../../behavior/use-library-board-edits.ts";
import { useLibraryCreate, useLibraryDuplicate } from "../../behavior/use-library-writes.ts";
import { useProductDashboards } from "../../behavior/use-product-dashboards.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { type StoreProject, useStoreProject } from "../../behavior/use-store-project.ts";
import { dashboardTemplatesPath, DRAFT_SEGMENT, draftBoardPath } from "../../model/boards.ts";
import {
  type LibraryBoard,
  libraryBoardPath,
  namesInProduct,
} from "../../model/organization-library.ts";
import {
  PRODUCT_BOARDS_SHOWN_MAX,
  productDefaultBoard,
  sharingTitle,
} from "../../model/product-dashboards.ts";
import { AddDashboardRow } from "../blocks/add-dashboard-row.tsx";
import { BoardMenu } from "../blocks/board-menu.tsx";
import { SIDEBAR_ROW_ICON_SIZE, SidebarLinkRow } from "../blocks/sidebar-link-row.tsx";
import { NewDashboardButton } from "../elements/new-dashboard-button.tsx";
import { BoardMenuDialogs } from "./board-menu-dialogs.tsx";
import { hasSharingChoice, NewDashboardDialog } from "./new-dashboard-dialog.tsx";

/** One title in every product, never with a project name (the G13 title rule). */
const LABEL = "Dashboards";

export function ProductDashboardsSection({ product }: ProductDashboardsProps) {
  const host = useAnalyticsHost();
  const { boards, allBoards, isLoaded } = useProductDashboards({ product });
  const store = useStoreProject();
  const [isShowingAll, setIsShowingAll] = useState(false);
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<LibraryBoard | undefined>();
  const [pendingDelete, setPendingDelete] = useState<LibraryBoard | undefined>();
  const { duplicateBoard } = useLibraryDuplicate();
  if (!isLoaded) return null;
  const projectSlug = host.project()?.slug;
  const pinned = productDefaultBoard({ product, projectSlug });
  // One gate for the "+" and the dotted row, so neither offers a create the other would not.
  const canCreate =
    Boolean(store.storeProject) && hasSharingChoice({ product, mayShare: store.mayShare });
  const isDraftOpen = projectSlug !== void 0 && host.route().params.dashboardId === DRAFT_SEGMENT;

  return (
    <VStack as="section" aria-label={LABEL} align="stretch" gap={0.5} width="full">
      <HStack minHeight="28px" paddingX={2} paddingTop={2.5} paddingBottom={0.5} gap={1}>
        <SidebarSectionLabel label={LABEL} />
        {canCreate && <NewDashboardButton onCreate={() => setIsNewDialogOpen(true)} />}
      </HStack>
      {isDraftOpen && (
        <RowList label="New dashboard">
          <DraftRow projectSlug={projectSlug} />
        </RowList>
      )}
      {boards.length === 0 && !pinned && !isDraftOpen && (
        <Text textStyle="bodySm" color="fg.subtle" paddingX={2} paddingY="4px">
          No dashboards yet
        </Text>
      )}
      <RowList label={LABEL}>
        {pinned && (
          <SidebarLinkRow
            name={pinned.name}
            href={pinned.href}
            icon={<Pin size={SIDEBAR_ROW_ICON_SIZE} />}
            iconTitle="Pinned: From LangWatch"
            isActive={host.route().params.templateId === pinned.templateId}
          />
        )}
        <BoardRows
          boards={boards}
          openId={host.route().params.dashboardId}
          isShowingAll={isShowingAll}
          onToggleShowAll={() => setIsShowingAll(!isShowingAll)}
          // A copy goes to the store project, so with none nothing is copied.
          onDuplicate={store.storeProject ? duplicateBoard : void 0}
          onMove={setPendingMove}
          onDelete={setPendingDelete}
        />
        {canCreate && <AddDashboardRow onAdd={() => setIsNewDialogOpen(true)} />}
      </RowList>
      {projectSlug && product === "llm-ops" && (
        <RowList label="Templates">
          <SidebarLinkRow
            name="Browse templates"
            href={dashboardTemplatesPath({ projectSlug })}
            icon={<LayoutTemplate size={SIDEBAR_ROW_ICON_SIZE} />}
          />
        </RowList>
      )}
      {isNewDialogOpen && (
        <ProductNewDashboard
          product={product}
          allBoards={allBoards}
          store={store}
          onClose={() => setIsNewDialogOpen(false)}
        />
      )}
      <BoardMenuDialogs
        pendingMove={pendingMove}
        onSettleMove={() => setPendingMove(void 0)}
        pendingDelete={pendingDelete}
        onSettleDelete={() => setPendingDelete(void 0)}
      />
    </VStack>
  );
}

/** The section's boards, the first few then "Show N more"; rows of the section's list. */
function BoardRows({
  boards,
  openId,
  isShowingAll,
  onToggleShowAll,
  onDuplicate,
  onMove,
  onDelete,
}: {
  boards: readonly LibraryBoard[];
  openId: string | undefined;
  isShowingAll: boolean;
  onToggleShowAll: () => void;
  onDuplicate: ((board: LibraryBoard) => void) | undefined;
  onMove: (board: LibraryBoard) => void;
  onDelete: (board: LibraryBoard) => void;
}) {
  const hiddenCount = boards.length - PRODUCT_BOARDS_SHOWN_MAX;
  const shownRows = isShowingAll ? boards : boards.slice(0, PRODUCT_BOARDS_SHOWN_MAX);
  return (
    <>
      {shownRows.map((board) => (
        <BoardRow
          key={board.id}
          board={board}
          isOpen={board.id === openId}
          onDuplicate={onDuplicate ? () => onDuplicate(board) : void 0}
          onMove={() => onMove(board)}
          onDelete={() => onDelete(board)}
        />
      ))}
      {hiddenCount > 0 && (
        <Box as="li" listStyleType="none">
          <ToggleRow onClick={onToggleShowAll}>
            {isShowingAll ? "Show less" : `Show ${hiddenCount} more`}
          </ToggleRow>
        </Box>
      )}
    </>
  );
}

/**
 * A board as a link: a lock on an Only me board, and who sees it on hover. Its "⋮" menu is the
 * library row's, with the same rules; Rename edits the name in place.
 */
function BoardRow({
  board,
  isOpen,
  onDuplicate,
  onMove,
  onDelete,
}: {
  board: LibraryBoard;
  isOpen: boolean;
  onDuplicate: (() => void) | undefined;
  onMove: () => void;
  onDelete: () => void;
}) {
  const edits = useLibraryBoardEdits();
  const [isRenaming, setIsRenaming] = useState(false);
  const actions = useBoardMenuActions({
    board,
    on: {
      rename: () => setIsRenaming(true),
      move: onMove,
      duplicate: onDuplicate,
      delete: onDelete,
    },
  });
  const href = libraryBoardPath(board);
  if (!href) return null;
  const Icon = board.scope === "PRIVATE" ? Lock : LayoutDashboard;
  const renaming = {
    onCommit: (name: string) => {
      setIsRenaming(false);
      edits.renameBoard({ board, name });
    },
    onCancel: () => setIsRenaming(false),
  };
  return (
    <SidebarLinkRow
      name={board.name}
      href={href}
      icon={<Icon size={SIDEBAR_ROW_ICON_SIZE} />}
      iconTitle={sharingTitle(board)}
      isActive={isOpen}
      menu={<BoardMenu name={board.name} actions={actions} />}
      renaming={isRenaming ? renaming : void 0}
    />
  );
}

/** The new board in view, listed while nothing is stored; its own row takes over once it is. */
function DraftRow({ projectSlug }: { projectSlug: string }) {
  const saved = useSavedDashboards();
  const draft = useDraftBoard({ takenNames: saved.boards.map(({ name }) => name) });
  if (draft.savedId !== void 0) return null;
  return (
    <SidebarLinkRow
      name={draft.board.name}
      href={draftBoardPath({ projectSlug })}
      icon={<LayoutDashboard size={14} />}
      isActive
    />
  );
}

/** "Show N more" / "Show less". */
function ToggleRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="plain"
      height="auto"
      justifyContent="flex-start"
      gap={1}
      paddingX={2}
      paddingY="4px"
      width="full"
      textStyle="bodySm"
      color="fg.subtle"
      _hover={{ color: "fg.muted" }}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RowList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack as="ul" aria-label={label} align="stretch" gap={0.5} margin={0} padding={0}>
      {children}
    </VStack>
  );
}

/**
 * The "+" opens the library's create dialog with the product fixed; made, the board opens
 * unsaved. In LLM Ops inside the store project it opens in that project, so this sidebar lists it.
 */
function ProductNewDashboard({
  product,
  allBoards,
  store,
  onClose,
}: {
  product: ProductDashboardsProps["product"];
  allBoards: readonly LibraryBoard[];
  store: StoreProject;
  onClose: () => void;
}) {
  const host = useAnalyticsHost();
  const creating = useLibraryCreate();
  const startDraft = useStartDraft();
  const { organizationName } = useBoardReader();
  if (!store.storeProject) return null;
  const inView = host.project();
  const projectDraft =
    product === "llm-ops" && inView?.id === store.storeProject.id ? inView : void 0;
  const create: typeof creating.createBoard = projectDraft
    ? (choices) => {
        startDraft({ projectId: projectDraft.id, projectSlug: projectDraft.slug, ...choices });
        return Promise.resolve(true);
      }
    : creating.createBoard;
  return (
    <NewDashboardDialog
      product={product}
      takenNamesIn={(home) => namesInProduct({ boards: allBoards, product: home })}
      projectName={store.storeProject.name}
      organizationName={organizationName}
      mayShare={store.mayShare}
      isCreating={creating.isCreating}
      onCreate={create}
      onClose={onClose}
    />
  );
}
