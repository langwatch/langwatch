/**
 * The "Saved dashboards" list navigation draws in the sidebar on dashboards
 * pages, lent through `withCapabilities` (§3.4 rule 7): analytics keeps the
 * reads and writes, navigation only places it. The Flight Deck always leads.
 */

import { Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { UiSavedDashboardsProps } from "@langwatch/browser-host/declarations";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Gauge, Plus, Star } from "lucide-react";
import { useId, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useSavedDashboards, type SavedBoard } from "../../behavior/use-saved-dashboards.ts";
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
  const mineLabelId = useId();
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
      <Text id={mineLabelId} paddingX={2} marginTop={1} {...GROUP_LABEL_STYLE} fontSize="9px">
        Mine
      </Text>
      <VStack
        as="ul"
        aria-labelledby={mineLabelId}
        align="stretch"
        gap={0.5}
        margin={0}
        padding={0}
      >
        <SavedDashboardRow
          name={FLIGHT_DECK.name}
          href={dashboardsPath({ projectSlug, dashboardId: FLIGHT_DECK.id })}
          icon={<Gauge size={15} />}
          isActive={activeDashboardId === FLIGHT_DECK.id}
          tag="Default"
        />
        {saved.boards.map((board) => (
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
