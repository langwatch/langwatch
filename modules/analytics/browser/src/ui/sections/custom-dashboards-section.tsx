/**
 * Custom dashboards in the analytics header: the Dashboards menu tab that lists and adds them,
 * and the current dashboard's own actions (rename, reorder, delete) beside its title.
 */
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Button } from "@langwatch/design-system/primitives";
import { toaster } from "@langwatch/design-system/toaster";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { ArrowDown, ArrowUp, Check, Edit2, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { analyticsApi } from "../../behavior/analytics-api.ts";
import { useDashboards } from "../../behavior/use-dashboards.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { DashboardNameDialog } from "./dashboard-name-dialog.tsx";

function dashboardHref({ projectSlug, dashboardId }: { projectSlug: string; dashboardId: string }) {
  return `/${projectSlug}/analytics/reports?dashboard=${dashboardId}`;
}

/** The Dashboards tab: a picker over the custom dashboards, ending with Add dashboard. */
export function DashboardsTabMenu({
  projectSlug,
  activeDashboardId,
  isActive,
}: {
  projectSlug: string;
  /** The dashboard on screen; the reports page resolves a default when the URL names none. */
  activeDashboardId?: string;
  isActive: boolean;
}) {
  const host = useAnalyticsHost();
  const project = host.project();
  const acceptsWrites = !isAggregateProjectKind(project?.kind);
  const currentDashboardId = isActive
    ? (activeDashboardId ?? host.route().query.dashboard)
    : void 0;
  // A dialog this tab mounts beside its menu: the menu's content unmounts when it closes.
  const [creatingDashboard, setCreatingDashboard] = useState(false);
  const dashboards = useDashboards({ projectId: project?.id ?? "" }).data ?? [];
  const current = dashboards.find((dashboard) => dashboard.id === currentDashboardId);

  return (
    <>
      <DashboardNameDialog
        open={creatingDashboard}
        onOpenChange={setCreatingDashboard}
        projectSlug={projectSlug}
      />
      <PageLayout.TabMenu
        label={current?.name ?? "Dashboards"}
        isActive={isActive}
        testId="analytics-dashboards-tab"
      >
        {dashboards.map((dashboard) => (
          <Menu.Item
            key={dashboard.id}
            value={dashboard.id}
            title={dashboard.name}
            aria-current={dashboard.id === currentDashboardId ? "page" : void 0}
            onClick={() => host.navigate(dashboardHref({ projectSlug, dashboardId: dashboard.id }))}
          >
            <Menu.ItemText truncate flex={1}>
              {dashboard.name}
            </Menu.ItemText>
            {dashboard.id === currentDashboardId ? <Check size={14} aria-hidden="true" /> : null}
          </Menu.Item>
        ))}
        {/* An aggregate (ADR-177) keeps no dashboards of its own. */}
        {acceptsWrites ? (
          <>
            {dashboards.length > 0 ? <Menu.Separator /> : null}
            <Menu.Item
              value="add-dashboard"
              data-testid="analytics-dashboard-add"
              onClick={() => setCreatingDashboard(true)}
            >
              <Plus size={14} /> Add dashboard
            </Menu.Item>
          </>
        ) : null}
      </PageLayout.TabMenu>
    </>
  );
}

/** The current dashboard's actions; rename hands back to the title row, which edits in place. */
export function DashboardActionsMenu({
  projectSlug,
  dashboardId,
  onRename,
}: {
  projectSlug: string;
  dashboardId: string;
  onRename?: () => void;
}) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const dashboardsQuery = useDashboards({ projectId });
  const deleteDashboard = analyticsApi.dashboards.delete.useMutation();
  const reorderDashboards = analyticsApi.dashboards.reorderDashboards.useMutation();

  const dashboards = dashboardsQuery.data ?? [];
  const index = dashboards.findIndex((dashboard) => dashboard.id === dashboardId);
  if (index === -1) return null;
  const name = dashboards[index]!.name;
  const canMoveUp = index > 0;
  const canMoveDown = index < dashboards.length - 1;
  const canDelete = dashboards.length > 1;

  const handleMove = (direction: "up" | "down") => {
    const reorder = swapWithNeighbour({ ids: dashboards.map((p) => p.id), dashboardId, direction });
    if (!reorder.moved) return;
    reorderDashboards.mutate(
      { projectId, dashboardIds: reorder.ids },
      {
        onSuccess: () => void dashboardsQuery.refetch(),
        onError: (error) => {
          host.failed({ error, fallbackTitle: "Couldn't reorder the dashboards" });
        },
      },
    );
  };

  const handleDelete = () => {
    if (!canDelete) {
      toaster.create({
        title: "Cannot delete the last dashboard",
        type: "warning",
        duration: 3000,
      });
      return;
    }
    setIsConfirmingDelete(true);
  };

  return (
    <>
      <ConfirmDialog
        open={isConfirmingDelete}
        onOpenChange={setIsConfirmingDelete}
        title="Delete dashboard"
        message="Are you sure you want to delete this dashboard? All graphs on this dashboard will be deleted."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteDashboard.isPending}
        onConfirm={() => {
          deleteDashboard.mutate(
            { projectId, dashboardId },
            {
              onSuccess: () => {
                void dashboardsQuery.refetch();
                // The plan gate counts dashboards, so deleting one frees an allowance the
                // licensing feature owns; declared in this package's procedure map.
                void utils.licenseEnforcement.checkLimit.invalidate();
                const next = dashboards.find((dashboard) => dashboard.id !== dashboardId);
                if (next) host.navigate(dashboardHref({ projectSlug, dashboardId: next.id }));
              },
              onError: (error) => {
                host.failed({ error, fallbackTitle: "Couldn't delete the dashboard" });
              },
              onSettled: () => setIsConfirmingDelete(false),
            },
          );
        }}
      />
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for dashboard ${name}`}
            data-testid="analytics-dashboard-menu"
          >
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {onRename ? (
            <Menu.Item value="rename" data-testid="analytics-dashboard-rename" onClick={onRename}>
              <Edit2 size={14} /> Rename
            </Menu.Item>
          ) : null}
          {canMoveUp && (
            <Menu.Item
              value="move-up"
              data-testid="analytics-dashboard-move-up"
              onClick={() => handleMove("up")}
            >
              <ArrowUp size={14} /> Move up
            </Menu.Item>
          )}
          {canMoveDown && (
            <Menu.Item
              value="move-down"
              data-testid="analytics-dashboard-move-down"
              onClick={() => handleMove("down")}
            >
              <ArrowDown size={14} /> Move down
            </Menu.Item>
          )}
          {canDelete && (
            <Menu.Item
              value="delete"
              color="red.fg"
              data-testid="analytics-dashboard-delete"
              onClick={handleDelete}
            >
              <Trash2 size={14} /> Delete
            </Menu.Item>
          )}
        </Menu.Content>
      </Menu.Root>
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
