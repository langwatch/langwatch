import { Box, Button, Input, Spinner } from "@chakra-ui/react";
import {
  ArrowDown,
  ArrowUp,
  Edit2,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { MenuLink } from "~/components/MenuLink";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface CustomDashboardsSectionProps {
  projectSlug: string;
}

export function CustomDashboardsSection({
  projectSlug,
}: CustomDashboardsSectionProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const currentDashboardId = router.query.dashboard as string | undefined;

  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(
    null,
  );
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const dashboardsQuery = api.dashboards.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const createDashboard = api.dashboards.create.useMutation();
  const renameDashboard = api.dashboards.rename.useMutation();
  const deleteDashboard = api.dashboards.delete.useMutation();
  const reorderDashboards = api.dashboards.reorderDashboards.useMutation();

  const dashboards = dashboardsQuery.data ?? [];

  // Focus input when editing starts
  useEffect(() => {
    if (editingDashboardId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingDashboardId]);

  const handleCreateDashboard = () => {
    const name = prompt(
      "Enter dashboard name:",
      `Dashboard ${dashboards.length + 1}`,
    );
    if (!name) return;

    createDashboard.mutate(
      { projectId, name },
      {
        onSuccess: (newDashboard) => {
          void dashboardsQuery.refetch();
          void router.push(
            `/${projectSlug}/analytics/reports?dashboard=${newDashboard.id}`,
          );
        },
        onError: () => {
          toaster.create({
            title: "Error creating dashboard",
            type: "error",
            duration: 3000,
            meta: { closable: true },
          });
        },
      },
    );
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
          onError: () => {
            toaster.create({
              title: "Error renaming dashboard",
              type: "error",
              duration: 3000,
              meta: { closable: true },
            });
          },
        },
      );
    }
    setEditingDashboardId(null);
    setEditingName("");
  };

  const handleMoveDashboard = (
    dashboardId: string,
    direction: "up" | "down",
  ) => {
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
        onError: () => {
          toaster.create({
            title: "Error reordering dashboards",
            type: "error",
            duration: 3000,
            meta: { closable: true },
          });
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
        meta: { closable: true },
      });
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to delete this dashboard? All graphs on this dashboard will be deleted.",
    );
    if (!confirmed) return;

    deleteDashboard.mutate(
      { projectId, dashboardId },
      {
        onSuccess: () => {
          void dashboardsQuery.refetch();
          // If we deleted the current dashboard, redirect to the first dashboard
          if (currentDashboardId === dashboardId) {
            const remainingDashboards = dashboards.filter(
              (d) => d.id !== dashboardId,
            );
            if (remainingDashboards[0]) {
              void router.push(
                `/${projectSlug}/analytics/reports?dashboard=${remainingDashboards[0].id}`,
              );
            }
          }
        },
        onError: () => {
          toaster.create({
            title: "Error deleting dashboard",
            type: "error",
            duration: 3000,
            meta: { closable: true },
          });
        },
      },
    );
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
            _hover={{ "& .menu-btn": { opacity: 1 } }}
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
                marginLeft={6}
                marginRight={2}
                marginY={1}
                fontSize="14px"
              />
            ) : (
              <>
                <MenuLink
                  href={`/${projectSlug}/analytics/reports?dashboard=${dashboard.id}`}
                  paddingX={6}
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
                      color="gray.500"
                      _hover={{ color: "gray.700" }}
                    >
                      <MoreVertical size={14} />
                    </Box>
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Item
                      value="rename"
                      onClick={() =>
                        handleStartRename(dashboard.id, dashboard.name)
                      }
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
                        onClick={() =>
                          handleMoveDashboard(dashboard.id, "down")
                        }
                      >
                        <ArrowDown size={14} /> Move Down
                      </Menu.Item>
                    )}
                    {dashboards.length > 1 && (
                      <Menu.Item
                        value="delete"
                        color="red.600"
                        onClick={(e: React.MouseEvent) =>
                          handleDeleteDashboard(e, dashboard.id)
                        }
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
      <Button
        size="sm"
        width="full"
        variant="ghost"
        onClick={handleCreateDashboard}
        opacity={createDashboard.isPending ? 0.5 : 1}
      >
        <Plus size={14} /> Add Dashboard
      </Button>
    </>
  );
}
