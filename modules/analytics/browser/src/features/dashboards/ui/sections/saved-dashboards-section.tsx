/**
 * The "Saved dashboards" list navigation draws in the sidebar, lent through
 * `withCapabilities` (§3.4 rule 7): analytics keeps the reads and writes.
 * Grouped Mine, Team, Organisation; the Flight Deck always leads Mine.
 */

import { Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { UiSavedDashboardsProps } from "@langwatch/browser-host/declarations";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Gauge, Plus, Star } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useSavedDashboards, type SavedBoard } from "../../behavior/use-saved-dashboards.ts";
import { boardVisibilityGroups } from "../../model/board-visibility.ts";
import { dashboardsPath, FLIGHT_DECK } from "../../model/boards.ts";
import { SavedDashboardRow } from "../blocks/saved-dashboard-row.tsx";

const GROUP_LABEL_STYLE = {
  fontSize: "10px",
  fontWeight: "semibold",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "fg.subtle",
} as const;

export function SavedDashboardsSection({ activeDashboardId }: UiSavedDashboardsProps) {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<SavedBoard | undefined>();
  const { projectSlug } = saved;

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const dashboardId = pendingDelete.id;
    saved.deleteBoard({
      dashboardId,
      onDeleted: () => {
        setPendingDelete(void 0);
        if (dashboardId !== activeDashboardId) return;
        host.navigate(dashboardsPath({ projectSlug, dashboardId: FLIGHT_DECK.id }));
      },
    });
  };

  return (
    <VStack align="stretch" gap={0.5} width="full" marginTop={3}>
      <HStack paddingX={2} gap={1}>
        <Text {...GROUP_LABEL_STYLE}>Saved dashboards</Text>
        <Spacer />
        <Button
          size="2xs"
          variant="ghost"
          aria-label="New dashboard"
          loading={saved.isCreating}
          onClick={saved.createBoard}
        >
          <Plus size={12} />
        </Button>
      </HStack>
      {boardVisibilityGroups(saved.boards).map((group) => (
        <BoardGroup key={group.key} label={group.label}>
          {group.key === "only_me" && (
            <SavedDashboardRow
              name={FLIGHT_DECK.name}
              href={dashboardsPath({ projectSlug, dashboardId: FLIGHT_DECK.id })}
              icon={<Gauge size={15} />}
              isActive={activeDashboardId === FLIGHT_DECK.id}
              tag="Default"
            />
          )}
          {group.boards.map((board) => (
            <SavedDashboardRow
              key={board.id}
              name={board.name}
              href={dashboardsPath({ projectSlug, dashboardId: board.id })}
              icon={<Star size={15} />}
              isActive={activeDashboardId === board.id}
              actions={{
                isRenaming: renamingId === board.id,
                onRenameStart: () => setRenamingId(board.id),
                onRenameCommit: (name) => {
                  setRenamingId(void 0);
                  saved.renameBoard({ dashboardId: board.id, name });
                },
                onRenameCancel: () => setRenamingId(void 0),
                onDelete: () => setPendingDelete(board),
              }}
            />
          ))}
        </BoardGroup>
      ))}
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

function BoardGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <>
      <Text id={labelId} paddingX={2} marginTop={1} {...GROUP_LABEL_STYLE} fontSize="9px">
        {label}
      </Text>
      <VStack as="ul" aria-labelledby={labelId} align="stretch" gap={0.5} margin={0} padding={0}>
        {children}
      </VStack>
    </>
  );
}
