import { Box, Button, Input, Spinner } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, Edit2, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { MenuLink } from "../elements/analytics-menu-link";
import { Menu } from "@langwatch/design-system/menu";
import { toaster } from "@langwatch/design-system/toaster";
import { useAnalyticsHost } from "../../model/analytics-host";
import { analyticsApi } from "../../behavior/analytics-api";
import { DashboardNameDialog } from "./dashboard-name-dialog";

interface CustomDashboardsSectionProps {
  projectSlug: string;
}

export function CustomDashboardsSection({ projectSlug }: CustomDashboardsSectionProps) {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const currentDashboardId = host.route().query.dashboard;
  /**
   * Creating a dashboard is a DIALOG THIS SECTION MOUNTS, not a registered
   * overlay. `platform/app` called `openDrawer("dashboardName")`, and that
   * registry is application chrome a packaged screen has nothing above it to
   * supply — the gateway family's ruling, applied to this family's own overlay:
   * the registry was composition, and a screen only ever needed the dialog.
   *
   * In component state rather than in the address, unlike the routing-policy
   * and queue editors: those open a NAMED thing, so a link to one is worth
   * having. This one names nothing — it is an empty form — so an address for it
   * would be a link to a blank dialog.
   */
  const [creatingDashboard, setCreatingDashboard] = useState(false);
  const utils = analyticsApi.useUtils();

  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [dashboardToDelete, setDashboardToDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dashboardsQuery = analyticsApi.dashboards.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

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
    const currentIndex = dashboards.findIndex((p) => p.id === dashboardId);
    if (currentIndex === -1) return;

    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= dashboards.length) return;

    // Create new order by swapping
    const newOrder = [...dashboards];
    const temp = newOrder[currentIndex];
    newOrder[currentIndex] = newOrder[newIndex]!;
    newOrder[newIndex] = temp!;

    reorderDashboards.mutate(
      { projectId, dashboardIds: newOrder.map((p) => p.id) },
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
      <Box paddingX={6} paddingY={2}>
        <Spinner size="sm" />
      </Box>
    );
  }

  // Determine which dashboard is selected based on URL or default to first
  const selectedDashboardId = currentDashboardId;

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
                if (currentDashboardId === dashboardId) {
                  const remainingDashboards = dashboards.filter((d) => d.id !== dashboardId);
                  if (remainingDashboards[0]) {
                    host.navigate(
                      `/${projectSlug}/analytics/reports?dashboard=${remainingDashboards[0].id}`,
                    );
                  }
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

        return (
          <Box
            key={dashboard.id}
            position="relative"
            width="full"
            borderRadius="lg"
            _hover={{ background: "bg.muted", "& .menu-btn": { opacity: 1 } }}
          >
            {isEditing ? (
              <Input
                ref={inputRef}
                size="xs"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFinishRename();
                  if (e.key === "Escape") {
                    setEditingDashboardId(null);
                    setEditingName("");
                  }
                }}
                marginLeft={4}
                marginRight={2}
                marginY={1}
                fontSize="14px"
              />
            ) : (
              <>
                <MenuLink
                  href={`/${projectSlug}/analytics/reports?dashboard=${dashboard.id}`}
                  isSelected={isSelected}
                >
                  {dashboard.name}
                </MenuLink>
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Box
                      as="button"
                      className="menu-btn"
                      position="absolute"
                      right={1}
                      top="50%"
                      transform="translateY(-50%)"
                      opacity={0}
                      transition="opacity 0.2s"
                      padding={1}
                      cursor="pointer"
                      color="fg.muted"
                      _hover={{ color: "fg.default" }}
                    >
                      <MoreVertical size={14} />
                    </Box>
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Item
                      value="rename"
                      onClick={() => handleStartRename(dashboard.id, dashboard.name)}
                    >
                      <Edit2 size={14} /> Rename
                    </Menu.Item>
                    {canMoveUp && (
                      <Menu.Item
                        value="move-up"
                        onClick={() => handleMoveDashboard(dashboard.id, "up")}
                      >
                        <ArrowUp size={14} /> Move Up
                      </Menu.Item>
                    )}
                    {canMoveDown && (
                      <Menu.Item
                        value="move-down"
                        onClick={() => handleMoveDashboard(dashboard.id, "down")}
                      >
                        <ArrowDown size={14} /> Move Down
                      </Menu.Item>
                    )}
                    {dashboards.length > 1 && (
                      <Menu.Item
                        value="delete"
                        color="red.600"
                        onClick={(e: React.MouseEvent) => handleDeleteDashboard(e, dashboard.id)}
                      >
                        <Trash2 size={14} /> Delete
                      </Menu.Item>
                    )}
                  </Menu.Content>
                </Menu.Root>
              </>
            )}
          </Box>
        );
      })}
      <Button size="sm" width="full" variant="ghost" onClick={handleCreateDashboard}>
        <Plus size={14} /> Add Dashboard
      </Button>
    </>
  );
}
