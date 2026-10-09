/**
 * The Dashboards sidebar navigation draws, lent through `SavedDashboardsToken` (§10.1):
 * "Your dashboards" with its "+", My dashboard and the team's boards, then the member's
 * stars, then From LangWatch. Analytics keeps the reads and writes.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { SavedDashboardsProps } from "@langwatch/analytics-client";
import type { DashboardStar } from "@langwatch/dashboard-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import {
  Box,
  Button,
  HStack,
  IconButton,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { ChevronRight, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useCuratedFold } from "../../behavior/use-curated-fold.ts";
import { useDuplicateCurated } from "../../behavior/use-duplicate-curated.ts";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import {
  curatedBoardPath,
  dashboardsPath,
  type DashboardsPlace,
  dashboardsPlace,
} from "../../model/boards.ts";
import {
  CURATED_BOARDS,
  type CuratedBoard,
  FROM_LANGWATCH_ABOUT,
} from "../../model/curated-boards.ts";
import {
  type SidebarBoard,
  type SidebarGroups,
  sidebarGroups,
  starRefOf,
  type StarredRow,
} from "../../model/sidebar-boards.ts";
import {
  CuratedDashboardRow,
  SavedDashboardRow,
  type StarActions,
} from "../blocks/saved-dashboard-row.tsx";
import { WidgetInfoTip } from "../blocks/widget-info-tip.tsx";

const GROUP_LABEL_STYLE = {
  fontSize: "9px",
  fontWeight: "semibold",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "fg.subtle",
} as const;

type Favourites = ReturnType<typeof useFavourites>;

/** A row's star, and its Move up / Move down while it sits in the Starred group. */
function starActionsFor({
  favourites,
  star,
  index,
  shown,
}: {
  favourites: Favourites;
  star: DashboardStar;
  /** Its place among the shown stars; absent outside the Starred group. */
  index: number | undefined;
  shown: readonly DashboardStar[];
}): StarActions {
  const base = {
    isStarred: favourites.isStarred(star),
    onToggleStar: () => favourites.toggleStar(star),
  };
  if (index === void 0) return base;
  const move = (direction: "up" | "down") => () => favourites.moveStar({ star, direction, shown });
  return {
    ...base,
    move: {
      ...(index > 0 ? { onMoveUp: move("up") } : {}),
      ...(index < shown.length - 1 ? { onMoveDown: move("down") } : {}),
    },
  };
}

/** Where each row reads the open address and the shown stars from. */
type RowPlace = { place: DashboardsPlace; shown: readonly DashboardStar[]; index?: number };

function BoardRow({
  board,
  isMine = false,
  isRenaming,
  onRenaming,
  onDelete,
  place,
  shown,
  index,
}: RowPlace & {
  board: SidebarBoard;
  isMine?: boolean;
  isRenaming: boolean;
  onRenaming: (isRenaming: boolean) => void;
  onDelete: () => void;
}) {
  const saved = useSavedDashboards();
  const favourites = useFavourites();
  const fromTemplate = useBoardFromTemplate();
  const star: DashboardStar = { kind: "board", dashboardId: board.id };
  return (
    <SavedDashboardRow
      name={board.name}
      href={dashboardsPath({ projectSlug: saved.projectSlug, dashboardId: board.id })}
      isActive={place.kind === "board" && place.dashboardId === board.id}
      actions={{
        ...starActionsFor({ favourites, star, index, shown }),
        isRenaming,
        ...(isMine ? {} : { onRenameStart: () => onRenaming(true), onDelete }),
        onRenameCommit: (name) => {
          onRenaming(false);
          saved.renameBoard({ dashboardId: board.id, name });
        },
        onRenameCancel: () => onRenaming(false),
        onDuplicate: () =>
          void fromTemplate.duplicateBoard({
            board,
            existingNames: saved.boards.map(({ name }) => name),
          }),
      }}
    />
  );
}

function CuratedRow({ curated, place, shown, index }: RowPlace & { curated: CuratedBoard }) {
  const { projectSlug } = useSavedDashboards();
  const favourites = useFavourites();
  const copy = useDuplicateCurated();
  const star: DashboardStar = { kind: "template", templateId: curated.templateId };
  return (
    <CuratedDashboardRow
      name={curated.name}
      href={curatedBoardPath({ projectSlug, templateId: curated.templateId })}
      isActive={place.kind === "curated" && place.templateId === curated.templateId}
      actions={{
        ...starActionsFor({ favourites, star, index, shown }),
        onDuplicate: () => void copy.duplicate(curated),
      }}
    />
  );
}

/** "Your dashboards" and "Starred", or their loading and error states. */
function BoardGroups({
  groups,
  place,
  onDelete,
}: {
  groups: SidebarGroups;
  place: DashboardsPlace;
  onDelete: (board: SidebarBoard) => void;
}) {
  const saved = useSavedDashboards();
  const favourites = useFavourites();
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const shown = groups.starred.map(starRefOf);
  const loadError = saved.loadError ?? favourites.loadError;

  if (loadError) {
    return (
      <Box paddingX={2}>
        <HandledErrorAlert error={loadError} fallbackTitle="Your dashboards could not be loaded" />
        <Button size="xs" variant="outline" marginTop={2} onClick={favourites.retry}>
          Retry
        </Button>
      </Box>
    );
  }
  if (saved.isLoading || favourites.isLoading) {
    return (
      <HStack paddingX={2} paddingY={1}>
        <Spinner size="xs" />
      </HStack>
    );
  }

  const boardRow = (board: SidebarBoard, extra: { isMine?: boolean; index?: number } = {}) => (
    <BoardRow
      key={board.id}
      board={board}
      place={place}
      shown={shown}
      isRenaming={renamingId === board.id}
      onRenaming={(isRenaming) => setRenamingId(isRenaming ? board.id : void 0)}
      onDelete={() => onDelete(board)}
      {...extra}
    />
  );
  const starredRow = (row: StarredRow, index: number) =>
    row.kind === "board" ? (
      boardRow(row.board, { index })
    ) : (
      <CuratedRow
        key={`curated-${row.curated.templateId}`}
        curated={row.curated}
        place={place}
        shown={shown}
        index={index}
      />
    );

  return (
    <>
      <RowList label="Your dashboards">
        {groups.myBoard && boardRow(groups.myBoard, { isMine: true })}
        {groups.yourBoards.map((board) => boardRow(board))}
      </RowList>
      {groups.starred.length > 0 && (
        <>
          <GroupLabel>Starred</GroupLabel>
          <RowList label="Starred dashboards">{groups.starred.map(starredRow)}</RowList>
        </>
      )}
    </>
  );
}

export function SavedDashboardsSection({ openPath }: SavedDashboardsProps) {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const favourites = useFavourites();
  const fold = useCuratedFold();
  const [pendingDelete, setPendingDelete] = useState<SidebarBoard | undefined>();
  const { projectSlug } = saved;
  const place = dashboardsPlace(openPath ?? "");
  const groups = sidebarGroups({
    boards: saved.boards,
    stars: favourites.stars,
    curated: CURATED_BOARDS,
    userId: host.userId(),
  });

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const dashboardId = pendingDelete.id;
    saved.deleteBoard({
      dashboardId,
      onDeleted: () => {
        setPendingDelete(void 0);
        const isOpen = place.kind === "board" && place.dashboardId === dashboardId;
        if (isOpen) host.navigate(dashboardsPath({ projectSlug }));
      },
    });
  };

  return (
    <VStack align="stretch" gap={0.5} width="full" marginTop={3.5}>
      <HStack paddingX={2} marginBottom={0.5} gap={1}>
        <Text {...GROUP_LABEL_STYLE}>Your dashboards</Text>
        <NewDashboardButton isCreating={saved.isCreating} onCreate={saved.createBoard} />
      </HStack>

      <BoardGroups groups={groups} place={place} onDelete={setPendingDelete} />

      {groups.fromLangWatch.length > 0 && (
        <>
          <HStack gap={0} marginTop={1} marginBottom={0.5}>
            <Button
              variant="plain"
              height="auto"
              justifyContent="flex-start"
              gap={1}
              paddingX={2}
              {...GROUP_LABEL_STYLE}
              _hover={{ color: "fg.muted" }}
              aria-expanded={!fold.folded}
              onClick={fold.toggle}
            >
              From LangWatch
              <Box
                as="span"
                display="flex"
                transition="transform 0.15s"
                transform={fold.folded ? void 0 : "rotate(90deg)"}
              >
                <ChevronRight size={9} aria-hidden />
              </Box>
            </Button>
            {/* Negative margins keep the (i) inside the heading's own height. */}
            <Box marginY="-4px" marginStart="-4px" display="flex">
              <WidgetInfoTip name="From LangWatch" description={FROM_LANGWATCH_ABOUT} />
            </Box>
          </HStack>
          {!fold.folded && (
            <RowList label="From LangWatch">
              {groups.fromLangWatch.map((curated) => (
                <CuratedRow key={curated.templateId} curated={curated} place={place} shown={[]} />
              ))}
            </RowList>
          )}
        </>
      )}

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

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <Text {...GROUP_LABEL_STYLE} paddingX={2} marginTop={1} marginBottom={0.5}>
      {children}
    </Text>
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
 * The "+" anchored to the heading creates a blank board at once. Templates stay one step away:
 * the new board offers them, so the sidebar needs no menu or library link.
 */
function NewDashboardButton({
  isCreating,
  onCreate,
}: {
  isCreating: boolean;
  onCreate: () => void;
}) {
  return (
    <Box marginLeft="auto" display="flex">
      <IconButton
        size="2xs"
        variant="ghost"
        minWidth={0}
        boxSize={4}
        color="fg.subtle"
        _hover={{ color: "fg", background: "border/60" }}
        aria-label="New dashboard"
        title="New dashboard"
        loading={isCreating}
        onClick={onCreate}
      >
        <Plus size={12} aria-hidden />
      </IconButton>
    </Box>
  );
}
