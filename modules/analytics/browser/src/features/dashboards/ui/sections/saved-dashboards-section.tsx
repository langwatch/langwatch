/**
 * The "Saved dashboards" list navigation draws in the sidebar, lent through
 * `withCapabilities` (§3.4 rule 7): analytics keeps the reads and writes.
 * Grouped Mine, Team, Organisation; only stored boards are listed, then the templates library.
 */

import { Box, IconButton, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { UiSavedDashboardsProps } from "@langwatch/browser-host/declarations";
import type { DashboardVisibility } from "@langwatch/dashboard-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Building2, LayoutTemplate, type LucideIcon, Plus, Star, Users } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useBoardVisibility } from "../../behavior/use-board-visibility.ts";
import { useDefaultBoard } from "../../behavior/use-default-board.ts";
import { useSavedDashboards, type SavedBoard } from "../../behavior/use-saved-dashboards.ts";
import { boardVisibilityGroups } from "../../model/board-visibility.ts";
import { dashboardsPath, dashboardTemplatesPath, TEMPLATES_SEGMENT } from "../../model/boards.ts";
import {
  SavedDashboardRow,
  type SavedDashboardRowActions,
} from "../blocks/saved-dashboard-row.tsx";

const GROUP_LABEL_STYLE = {
  fontSize: "10px",
  fontWeight: "semibold",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "gray.400",
} as const;

/** The prototype tints a shared board's icon by who it is shown to. */
const ROW_ICONS: Readonly<Record<DashboardVisibility, { icon: LucideIcon; color?: string }>> = {
  only_me: { icon: Star },
  team: { icon: Users, color: "blue.600" },
  organisation: { icon: Building2, color: "orange.600" },
};

function RowIcon({ icon: Icon, color }: { icon: LucideIcon; color?: string }) {
  return (
    <Box as="span" display="flex" color={color}>
      <Icon size={15} strokeWidth={1.9} aria-hidden />
    </Box>
  );
}

export function SavedDashboardsSection({ activeDashboardId }: UiSavedDashboardsProps) {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<SavedBoard | undefined>();
  const { projectSlug } = saved;
  const { defaultBoardId, setDefaultBoard } = useDefaultBoard();
  const fromTemplate = useBoardFromTemplate();
  const boardNames = saved.boards.map(({ name }) => name);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const dashboardId = pendingDelete.id;
    saved.deleteBoard({
      dashboardId,
      onDeleted: () => {
        setPendingDelete(void 0);
        // The area's landing picks the next board, or makes one when none is left.
        if (dashboardId === activeDashboardId) host.navigate(dashboardsPath({ projectSlug }));
      },
    });
  };

  return (
    <VStack align="stretch" gap={0.5} width="full" marginTop={3.5}>
      <HStack paddingX={2} gap={1} marginBottom={0.5}>
        <Text {...GROUP_LABEL_STYLE}>Saved dashboards</Text>
        <Spacer />
        <IconButton
          variant="ghost"
          boxSize={4}
          minWidth={4}
          borderRadius="sm"
          color="gray.400"
          _hover={{ background: "border/60", color: "fg" }}
          aria-label="New dashboard"
          loading={saved.isCreating}
          onClick={saved.createBoard}
        >
          <Plus size={12} />
        </IconButton>
      </HStack>
      {boardVisibilityGroups(saved.boards).map((group) => (
        <BoardGroup key={group.key} label={group.label}>
          {group.boards.map((board) => (
            <BoardRow
              key={board.id}
              board={board}
              href={dashboardsPath({ projectSlug, dashboardId: board.id })}
              isActive={activeDashboardId === board.id}
              actions={{
                isRenaming: renamingId === board.id,
                onRenameStart: () => setRenamingId(board.id),
                onRenameCommit: (name) => {
                  setRenamingId(void 0);
                  saved.renameBoard({ dashboardId: board.id, name });
                },
                onRenameCancel: () => setRenamingId(void 0),
                isDefault: defaultBoardId === board.id,
                onSetDefault: () => {
                  setDefaultBoard(board.id);
                  host.succeeded({ title: `"${board.name}" is now your default dashboard` });
                },
                onDuplicate: () =>
                  void fromTemplate.duplicateBoard({ board, existingNames: boardNames }),
                onDelete: () => setPendingDelete(board),
              }}
            />
          ))}
        </BoardGroup>
      ))}
      <VStack as="ul" aria-label="Templates" align="stretch" gap={0.5} margin={0} padding={0}>
        <SavedDashboardRow
          name="Templates"
          href={dashboardTemplatesPath({ projectSlug })}
          icon={<RowIcon icon={LayoutTemplate} />}
          isActive={activeDashboardId === TEMPLATES_SEGMENT}
        />
      </VStack>
      <ConfirmDialog
        open={pendingDelete !== void 0}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDelete(void 0);
        }}
        title="Delete dashboard"
        message={`Delete "${pendingDelete?.name ?? ""}" and every block on it? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={saved.isDeleting}
        onConfirm={confirmDelete}
      />
    </VStack>
  );
}

/** A board's row, with Share and Delete offered only to a member who may use them (AC26). */
function BoardRow({
  board,
  href,
  isActive,
  actions,
}: {
  board: SavedBoard;
  href: string;
  isActive: boolean;
  actions: SavedDashboardRowActions;
}) {
  const visibility = useBoardVisibility({ board, reportsRefusal: true });
  return (
    <SavedDashboardRow
      name={board.name}
      href={href}
      icon={<RowIcon {...ROW_ICONS[board.visibility]} />}
      isActive={isActive}
      actions={{
        ...actions,
        share: visibility.canChange
          ? { visibility: visibility.visibility, onChange: visibility.setVisibility }
          : void 0,
        onDelete: visibility.canChange ? actions.onDelete : void 0,
      }}
    />
  );
}

function BoardGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <>
      <Text
        id={labelId}
        paddingX={2}
        marginTop={1}
        marginBottom={0.5}
        {...GROUP_LABEL_STYLE}
        fontSize="9px"
        color="gray.400/80"
      >
        {label}
      </Text>
      <VStack as="ul" aria-labelledby={labelId} align="stretch" gap={0.5} margin={0} padding={0}>
        {children}
      </VStack>
    </>
  );
}
