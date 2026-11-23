/**
 * Product sidebar "Dashboards" section: My dashboard, then the product's boards, each with the
 * library's "⋮" menu on hover. "No dashboards yet" when empty, in every product. "Browse
 * templates" only in LLM Ops: templates read its data.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { ProductDashboardsProps } from "@langwatch/analytics-client";
import { SidebarSectionLabel } from "@langwatch/design-system/app-shell";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { LayoutDashboard, LayoutTemplate, Lock } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardReader } from "../../behavior/use-board-access.ts";
import { useLibraryBoardEdits } from "../../behavior/use-library-board-edits.ts";
import { useLibraryCreate, useLibraryDuplicate } from "../../behavior/use-library-writes.ts";
import { useProductDashboards } from "../../behavior/use-product-dashboards.ts";
import { type StoreProject, useStoreProject } from "../../behavior/use-store-project.ts";
import { dashboardTemplatesPath } from "../../model/boards.ts";
import {
  type LibraryBoard,
  libraryBoardPath,
  namesInProduct,
} from "../../model/organization-library.ts";
import { PRODUCT_BOARDS_SHOWN_MAX, sharingTitle } from "../../model/product-dashboards.ts";
import { BoardMenu, hasBoardMenuItems } from "../blocks/board-menu.tsx";
import { SidebarLinkRow } from "../blocks/sidebar-link-row.tsx";
import { NewDashboardButton } from "../elements/new-dashboard-button.tsx";
import { BoardMenuDialogs } from "./board-menu-dialogs.tsx";
import { boardMenuActions } from "./library-board-rows.tsx";
import { hasSharingChoice, NewDashboardDialog } from "./new-dashboard-dialog.tsx";

/** One title in every product, never with a project name (the G13 title rule). */
const LABEL = "Dashboards";

export function ProductDashboardsSection({ product }: ProductDashboardsProps) {
  const host = useAnalyticsHost();
  const { boards, allBoards, isLoaded } = useProductDashboards({ product });
  const store = useStoreProject();
  const [isShowingAll, setIsShowingAll] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingMove, setPendingMove] = useState<LibraryBoard | undefined>();
  const [pendingDelete, setPendingDelete] = useState<LibraryBoard | undefined>();
  const { duplicateBoard } = useLibraryDuplicate();
  if (!isLoaded) return null;
  const projectSlug = host.project()?.slug;
  const openId = host.route().params.dashboardId;
  const hiddenCount = boards.length - PRODUCT_BOARDS_SHOWN_MAX;
  const shownRows = isShowingAll ? boards : boards.slice(0, PRODUCT_BOARDS_SHOWN_MAX);
  const boardRow = (board: LibraryBoard) => (
    <BoardRow
      key={board.id}
      board={board}
      isOpen={board.id === openId}
      // A copy goes to the store project, so with none nothing is copied.
      onDuplicate={store.storeProject ? () => duplicateBoard(board) : void 0}
      onMove={() => setPendingMove(board)}
      onDelete={() => setPendingDelete(board)}
    />
  );

  return (
    <VStack as="section" aria-label={LABEL} align="stretch" gap={0.5} width="full">
      <HStack minHeight="28px" paddingX={2} paddingTop={2.5} paddingBottom={0.5} gap={1}>
        <SidebarSectionLabel label={LABEL} />
        {store.storeProject && hasSharingChoice({ product, mayShare: store.mayShare }) && (
          <NewDashboardButton isCreating={false} onCreate={() => setIsCreating(true)} />
        )}
      </HStack>
      {boards.length === 0 && (
        <Text textStyle="bodySm" color="fg.subtle" paddingX={2} paddingY="4px">
          No dashboards yet
        </Text>
      )}
      {boards.length > 0 && (
        <RowList label={LABEL}>
          {shownRows.map(boardRow)}
          {hiddenCount > 0 && (
            <Box as="li" listStyleType="none">
              <ToggleRow onClick={() => setIsShowingAll(!isShowingAll)}>
                {isShowingAll ? "Show less" : `Show ${hiddenCount} more`}
              </ToggleRow>
            </Box>
          )}
        </RowList>
      )}
      {projectSlug && product === "llm-ops" && (
        <RowList label="Templates">
          <SidebarLinkRow
            name="Browse templates"
            href={dashboardTemplatesPath({ projectSlug })}
            icon={<LayoutTemplate size={14} />}
          />
        </RowList>
      )}
      {isCreating && (
        <ProductNewDashboard
          product={product}
          allBoards={allBoards}
          store={store}
          onClose={() => setIsCreating(false)}
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
  const host = useAnalyticsHost();
  const edits = useLibraryBoardEdits();
  const [isRenaming, setIsRenaming] = useState(false);
  const href = libraryBoardPath(board);
  if (!href) return null;
  const Icon = board.scope === "PRIVATE" ? Lock : LayoutDashboard;
  const actions = boardMenuActions({
    board,
    host,
    on: {
      rename: () => setIsRenaming(true),
      move: onMove,
      duplicate: onDuplicate,
      delete: onDelete,
    },
  });
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
      icon={<Icon size={14} />}
      iconTitle={sharingTitle(board)}
      isActive={isOpen}
      menu={hasBoardMenuItems(actions) ? <BoardMenu name={board.name} actions={actions} /> : null}
      renaming={isRenaming ? renaming : void 0}
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

/** The "+" opens the library's create dialog with the product fixed; made, the board opens. */
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
  const creating = useLibraryCreate();
  const { organizationName } = useBoardReader();
  if (!store.storeProject) return null;
  return (
    <NewDashboardDialog
      product={product}
      takenNamesIn={(home) => namesInProduct({ boards: allBoards, product: home })}
      projectName={store.storeProject.name}
      organizationName={organizationName}
      mayShare={store.mayShare}
      isCreating={creating.isCreating}
      onCreate={creating.createBoard}
      onClose={onClose}
    />
  );
}
