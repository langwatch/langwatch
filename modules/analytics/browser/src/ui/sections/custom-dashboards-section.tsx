import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, Input, Spinner } from "@langwatch/design-system/primitives";
import {
  SectionNavigationAddRow,
  SectionNavigationItem,
} from "@langwatch/design-system/section-navigation-frame";
import { toaster } from "@langwatch/design-system/toaster";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { ArrowDown, ArrowUp, Edit2, MoreVertical, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { analyticsApi } from "../../behavior/analytics-api.ts";
import { useDashboards } from "../../behavior/use-dashboards.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { DashboardNameDialog } from "./dashboard-name-dialog.tsx";

interface CustomDashboardsSectionProps {
  projectSlug: string;
  activeDashboardId?: string;
}

export function CustomDashboardsSection({
  projectSlug,
  activeDashboardId,
}: CustomDashboardsSectionProps) {
  const host = useAnalyticsHost();
  const project = host.project();
  const acceptsWrites = !isAggregateProjectKind(project?.kind);
  const projectId = project?.id ?? "";
  const currentDashboardId = host.route().query.dashboard;
  /**
   * Creating a dashboard is a DIALOG THIS SECTION MOUNTS, not a registered overlay — a screen
   * has nothing above it to supply that registry. Kept in component state, not the address:
   * unlike the routing-policy and queue editors, this dialog names nothing worth linking to.
   */
  const [creatingDashboard, setCreatingDashboard] = useState(false);
  const utils = analyticsApi.useUtils();

  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [dashboardToDelete, setDashboardToDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dashboardsQuery = useDashboards({ projectId });

  const renameDashboard = analyticsApi.dashboards.rename.useMutation();
  const deleteDashboard = analyticsApi.dashboards.delete.useMutation();
  const reorderDashboards = analyticsApi.dashboards.reorderDashboards.useMutation();

  const dashboards = dashboardsQuery.data ?? [];

  // Focus input when editing starts
  useEffect(() => {
    if (editingDashboardId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingDashboardId]);

  const handleCreateDashboard = () => {
    setCreatingDashboard(true);
  };

  const handleStartRename = (dashboardId: string, currentName: string) => {
    setEditingDashboardId(dashboardId);
    setEditingName(currentName);
  };

  const handleFinishRename = () => {
    if (editingDashboardId && editingName.trim()) {
      renameDashboard.mutate(
        {
          projectId,
          dashboardId: editingDashboardId,
          name: editingName.trim(),
        },
        {
          onSuccess: () => {
            void dashboardsQuery.refetch();
          },
          onError: (error) => {
            host.failed({ error, fallbackTitle: "Couldn't rename the dashboard" });
          },
        },
      );
    }
    setEditingDashboardId(null);
    setEditingName("");
  };

  const handleMoveDashboard = (dashboardId: string, direction: "up" | "down") => {
    const reorder = swapWithNeighbour({ ids: dashboards.map((p) => p.id), dashboardId, direction });
    if (!reorder.moved) return;

    reorderDashboards.mutate(
      { projectId, dashboardIds: reorder.ids },
      {
        onSuccess: () => {
          void dashboardsQuery.refetch();
        },
        onError: (error) => {
          host.failed({ error, fallbackTitle: "Couldn't reorder the dashboards" });
        },
      },
    );
  };

  const handleDeleteDashboard = (e: React.MouseEvent, dashboardId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (dashboards.length <= 1) {
      toaster.create({
        title: "Cannot delete the last dashboard",
        type: "warning",
        duration: 3000,
      });
      return;
    }

    setDashboardToDelete(dashboardId);
  };

  if (dashboardsQuery.isLoading) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Spinner size="sm" />
      </Box>
    );
  }

  // The reports page resolves its default dashboard even when the URL has no ID.
  const selectedDashboardId = activeDashboardId ?? currentDashboardId;

  return (
    <>
      <DashboardNameDialog
        open={creatingDashboard}
        onOpenChange={setCreatingDashboard}
        projectSlug={projectSlug}
      />
      <ConfirmDialog
        open={!!dashboardToDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDashboardToDelete(null);
        }}
        title="Delete dashboard"
        message="Are you sure you want to delete this dashboard? All graphs on this dashboard will be deleted."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteDashboard.isPending}
        onConfirm={() => {
          if (!dashboardToDelete) return;
          const dashboardId = dashboardToDelete;
          deleteDashboard.mutate(
            { projectId, dashboardId },
            {
              onSuccess: () => {
                void dashboardsQuery.refetch();
                // The plan gate counts dashboards, so deleting one frees an
                // allowance the licensing feature owns. Declared in this
                // package's procedure map so the invalidation is typed rather
                // than a string that silently stops matching.
                void utils.licenseEnforcement.checkLimit.invalidate();
                // If we deleted the current dashboard, redirect to the first dashboard
                const remainingDashboards = dashboards.filter((d) => d.id !== dashboardId);
                if (currentDashboardId === dashboardId && remainingDashboards[0]) {
                  host.navigate(
                    `/${projectSlug}/analytics/reports?dashboard=${remainingDashboards[0].id}`,
                  );
                }
              },
              onError: (error) => {
                host.failed({ error, fallbackTitle: "Couldn't delete the dashboard" });
              },
              onSettled: () => setDashboardToDelete(null),
            },
          );
        }}
      />
      {dashboards.map((dashboard, index) => {
        const isSelected = selectedDashboardId === dashboard.id;
        const isEditing = editingDashboardId === dashboard.id;
        const canMoveUp = index > 0;
        const canMoveDown = index < dashboards.length - 1;
        const href = `/${projectSlug}/analytics/reports?dashboard=${dashboard.id}`;

        return (
          <Box key={dashboard.id}>
            {isEditing ? (
              <DashboardNameInput
                inputRef={inputRef}
                value={editingName}
                onChange={setEditingName}
                onCommit={handleFinishRename}
                onCancel={() => {
                  setEditingDashboardId(null);
                  setEditingName("");
                }}
              />
            ) : (
              <SectionNavigationItem
                link={{
                  label: dashboard.name,
                  href,
                  actions: (
                    <DashboardRowMenu
                      name={dashboard.name}
                      canMoveUp={canMoveUp}
                      canMoveDown={canMoveDown}
                      canDelete={dashboards.length > 1}
                      onRename={() => handleStartRename(dashboard.id, dashboard.name)}
                      onMove={(direction) => handleMoveDashboard(dashboard.id, direction)}
                      onDelete={(e) => handleDeleteDashboard(e, dashboard.id)}
                    />
                  ),
                }}
                activeHref={isSelected ? href : ""}
                onNavigate={(to) => host.navigate(to)}
              />
            )}
          </Box>
        );
      })}
      {/* An aggregate (ADR-177) keeps no dashboards of its own. */}
      {acceptsWrites && (
        <SectionNavigationAddRow
          add={{
            label: "Add Dashboard",
            onClick: handleCreateDashboard,
            testId: "analytics-dashboard-add",
          }}
        />
      )}
    </>
  );
}

/** Swaps a dashboard with its neighbour; `moved` is false at either end of the list. */
function swapWithNeighbour({
  ids,
  dashboardId,
  direction,
}: {
  ids: string[];
  dashboardId: string;
  direction: "up" | "down";
}): { moved: true; ids: string[] } | { moved: false } {
  const currentIndex = ids.indexOf(dashboardId);
  if (currentIndex === -1) return { moved: false };
  const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (newIndex < 0 || newIndex >= ids.length) return { moved: false };
  const reordered = [...ids];
  reordered[currentIndex] = ids[newIndex]!;
  reordered[newIndex] = ids[currentIndex]!;
  return { moved: true, ids: reordered };
}

function DashboardRowMenu({
  name,
  canMoveUp,
  canMoveDown,
  canDelete,
  onRename,
  onMove,
  onDelete,
}: {
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onRename: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for dashboard ${name}`}
          data-testid={`analytics-dashboard-menu-${name}`}
          minWidth={0}
          height="20px"
          paddingX={1}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="rename" data-testid="analytics-dashboard-rename" onClick={onRename}>
          <Edit2 size={14} /> Rename
        </Menu.Item>
        {canMoveUp && (
          <Menu.Item
            value="move-up"
            data-testid="analytics-dashboard-move-up"
            onClick={() => onMove("up")}
          >
            <ArrowUp size={14} /> Move Up
          </Menu.Item>
        )}
        {canMoveDown && (
          <Menu.Item
            value="move-down"
            data-testid="analytics-dashboard-move-down"
            onClick={() => onMove("down")}
          >
            <ArrowDown size={14} /> Move Down
          </Menu.Item>
        )}
        {canDelete && (
          <Menu.Item
            value="delete"
            color="red.fg"
            data-testid="analytics-dashboard-delete"
            onClick={onDelete}
          >
            <Trash2 size={14} /> Delete
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

function DashboardNameInput({
  inputRef,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <Input
      ref={inputRef}
      data-testid="analytics-dashboard-rename-input"
      size="xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        if (e.key === "Escape") onCancel();
      }}
      marginY={0.5}
      fontSize="14px"
    />
  );
}
