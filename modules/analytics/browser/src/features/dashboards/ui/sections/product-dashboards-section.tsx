/**
 * A product sidebar's "Dashboards" section, lent through `ProductDashboardsToken` (§10.1): the
 * member's My dashboard and boards not starred, 8 then "Show N more", the product's starred ones,
 * its From LangWatch boards, and in LLM Ops "Browse templates". Hidden with nothing to list.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { ProductDashboardsProps } from "@langwatch/analytics-client";
import { SidebarSectionLabel } from "@langwatch/design-system/app-shell";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ChevronRight, LayoutDashboard, LayoutTemplate, Lock } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardReader } from "../../behavior/use-board-access.ts";
import { useCuratedFold } from "../../behavior/use-curated-fold.ts";
import { useLibraryCreate } from "../../behavior/use-library-writes.ts";
import { useProductDashboards } from "../../behavior/use-product-dashboards.ts";
import { type StoreProject, useStoreProject } from "../../behavior/use-store-project.ts";
import { curatedBoardPath, dashboardTemplatesPath } from "../../model/boards.ts";
import type { CuratedBoard } from "../../model/curated-boards.ts";
import {
  type LibraryBoard,
  libraryBoardPath,
  namesInProduct,
} from "../../model/organization-library.ts";
import {
  hasProductBoards,
  PRODUCT_BOARDS_SHOWN_MAX,
  sharingTitle,
} from "../../model/product-dashboards.ts";
import { SidebarLinkRow } from "../blocks/sidebar-link-row.tsx";
import { NewDashboardButton } from "../elements/new-dashboard-button.tsx";
import { NewDashboardDialog } from "./new-dashboard-dialog.tsx";

/** One title in every product, never with a project name (the G13 title rule). */
const LABEL = "Dashboards";

const GROUP_LABEL_STYLE = { textStyle: "eyebrow", color: "fg.subtle" } as const;

export function ProductDashboardsSection({ product }: ProductDashboardsProps) {
  const host = useAnalyticsHost();
  const { boards, allBoards, isLoaded } = useProductDashboards({ product });
  const store = useStoreProject();
  const fold = useCuratedFold();
  const [isShowingAll, setIsShowingAll] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  if (!isLoaded || !hasProductBoards(boards)) return null;
  const projectSlug = host.project()?.slug;
  const openId = host.route().params.dashboardId;
  const hiddenCount = boards.rows.length - PRODUCT_BOARDS_SHOWN_MAX;
  const shownRows = isShowingAll ? boards.rows : boards.rows.slice(0, PRODUCT_BOARDS_SHOWN_MAX);
  const starredCount = boards.starred.length + boards.starredCurated.length;
  const boardRow = (board: LibraryBoard) => (
    <BoardRow key={board.id} board={board} isOpen={board.id === openId} />
  );
  const curatedRow = (curated: CuratedBoard) =>
    projectSlug ? (
      <SidebarLinkRow
        key={curated.templateId}
        name={curated.name}
        href={curatedBoardPath({ projectSlug, templateId: curated.templateId })}
        icon={<LayoutDashboard size={14} />}
      />
    ) : null;

  return (
    <VStack as="section" aria-label={LABEL} align="stretch" gap={0.5} width="full">
      <HStack minHeight="28px" paddingX={2} paddingTop={2.5} paddingBottom={0.5} gap={1}>
        <SidebarSectionLabel label={LABEL} />
        {store.storeProject && (
          <NewDashboardButton isCreating={false} onCreate={() => setIsCreating(true)} />
        )}
      </HStack>
      {boards.rows.length > 0 && (
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
      {starredCount > 0 && (
        <>
          <Text {...GROUP_LABEL_STYLE} paddingX={2} marginTop={1} marginBottom={0.5}>
            Starred
          </Text>
          <RowList label="Starred">
            {boards.starred.map(boardRow)}
            {boards.starredCurated.map(curatedRow)}
          </RowList>
        </>
      )}
      {boards.fromLangWatch.length > 0 && (
        <>
          <ToggleRow isLabel isExpanded={!fold.folded} onClick={fold.toggle}>
            From LangWatch
          </ToggleRow>
          {!fold.folded && (
            <RowList label="From LangWatch">{boards.fromLangWatch.map(curatedRow)}</RowList>
          )}
        </>
      )}
      {product === "llm-ops" && projectSlug && (
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
    </VStack>
  );
}

/** A board as a plain link: a lock on an Only me board, and who sees it on hover. */
function BoardRow({ board, isOpen }: { board: LibraryBoard; isOpen: boolean }) {
  const href = libraryBoardPath(board);
  if (!href) return null;
  const Icon = board.scope === "PRIVATE" ? Lock : LayoutDashboard;
  return (
    <SidebarLinkRow
      name={board.name}
      href={href}
      icon={<Icon size={14} />}
      iconTitle={sharingTitle(board)}
      isActive={isOpen}
    />
  );
}

/** "Show N more" / "Show less", or a foldable group heading with its chevron. */
function ToggleRow({
  isLabel = false,
  isExpanded,
  onClick,
  children,
}: {
  isLabel?: boolean;
  isExpanded?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="plain"
      height="auto"
      justifyContent="flex-start"
      gap={1}
      paddingX={2}
      paddingY={isLabel ? 0 : "4px"}
      marginTop={isLabel ? 1 : 0}
      width={isLabel ? "auto" : "full"}
      {...(isLabel ? GROUP_LABEL_STYLE : { textStyle: "bodySm", color: "fg.subtle" })}
      _hover={{ color: "fg.muted" }}
      aria-expanded={isExpanded}
      onClick={onClick}
    >
      {children}
      {isExpanded !== void 0 && (
        <Box
          as="span"
          display="flex"
          transition="transform 0.15s"
          transform={isExpanded ? "rotate(90deg)" : void 0}
        >
          <ChevronRight size={9} aria-hidden />
        </Box>
      )}
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
