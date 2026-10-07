/**
 * The sidebar list navigation draws, lent through `SavedDashboardsToken`
 * (§10.1): the member's starred boards for this project, in their own order,
 * then an "All dashboards" link. Analytics keeps the reads and writes.
 */

import type { SavedDashboardsProps } from "@langwatch/analytics-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Box, Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { LayoutDashboard } from "lucide-react";
import { useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useFavourites, type StarredBoard } from "../../behavior/use-favourites.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { dashboardsPath, TEMPLATES_SEGMENT } from "../../model/boards.ts";
import { SavedDashboardLink, SavedDashboardRow } from "../blocks/saved-dashboard-row.tsx";

const GROUP_LABEL_STYLE = {
  fontSize: "10px",
  fontWeight: "semibold",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "gray.400",
} as const;

export function SavedDashboardsSection({ activeDashboardId }: SavedDashboardsProps) {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const favourites = useFavourites();
  const fromTemplate = useBoardFromTemplate();
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<StarredBoard | undefined>();
  const { projectSlug } = saved;
  const boardNames = saved.boards.map(({ name }) => name);
  const stars = favourites.stars;
  const allActive = activeDashboardId === void 0 || activeDashboardId === TEMPLATES_SEGMENT;

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const dashboardId = pendingDelete.id;
    saved.deleteBoard({
      dashboardId,
      onDeleted: () => {
        setPendingDelete(void 0);
        if (dashboardId === activeDashboardId) host.navigate(dashboardsPath({ projectSlug }));
      },
    });
  };

  const renderStars = () => {
    if (favourites.loadError) {
      return (
        <Box paddingX={2}>
          <HandledErrorAlert
            error={favourites.loadError}
            fallbackTitle="Your starred dashboards could not be loaded"
          />
          <Button size="xs" variant="outline" marginTop={2} onClick={favourites.retry}>
            Retry
          </Button>
        </Box>
      );
    }
    if (favourites.isLoading) {
      return (
        <HStack paddingX={2} paddingY={1}>
          <Spinner size="xs" />
        </HStack>
      );
    }
    if (stars.length === 0) {
      return (
        <Text paddingX={2} paddingY={1} fontSize="12px" color="fg.subtle">
          Star a dashboard to pin it here.
        </Text>
      );
    }
    return (
      <VStack
        as="ul"
        aria-label="Starred dashboards"
        align="stretch"
        gap={0.5}
        margin={0}
        padding={0}
      >
        {stars.map((board, index) => (
          <SavedDashboardRow
            key={board.id}
            name={board.name}
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
              onDuplicate: () =>
                void fromTemplate.duplicateBoard({ board, existingNames: boardNames }),
              onUnstar: () => favourites.toggleStar({ dashboardId: board.id, isStarred: true }),
              onDelete: () => setPendingDelete(board),
              ...(index > 0
                ? {
                    onMoveUp: () => favourites.moveStar({ dashboardId: board.id, direction: "up" }),
                  }
                : {}),
              ...(index < stars.length - 1
                ? {
                    onMoveDown: () =>
                      favourites.moveStar({ dashboardId: board.id, direction: "down" }),
                  }
                : {}),
            }}
          />
        ))}
      </VStack>
    );
  };

  return (
    <VStack align="stretch" gap={0.5} width="full" marginTop={3.5}>
      <HStack paddingX={2} marginBottom={0.5}>
        <Text {...GROUP_LABEL_STYLE}>Starred</Text>
      </HStack>

      {renderStars()}

      <VStack
        as="ul"
        aria-label="All dashboards"
        align="stretch"
        gap={0.5}
        margin={0}
        padding={0}
        marginTop={1}
      >
        <SavedDashboardLink
          name="All dashboards"
          href={dashboardsPath({ projectSlug })}
          icon={
            <Box as="span" display="flex" color="fg.subtle">
              <LayoutDashboard size={15} strokeWidth={1.9} aria-hidden />
            </Box>
          }
          isActive={allActive}
        />
      </VStack>

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
