/**
 * charts-proto — S1 guided query-builder dashboard (PROTOTYPE PAGE).
 *
 * A New-Relic-style configurable dashboard built on strategy S1 from the #5670
 * dashboard design doc: a grid of widgets, each authored by a guided trace-query
 * builder with a live-morphing preview, composed by drag/resize.
 *
 * ⚠ This is a UX PROTOTYPE. The data layer is entirely stubbed (see stubData.ts)
 * and composition lives in localStorage — there is no backend wiring yet. The
 * builder controls mirror the real, tenant-isolated β TRQL allowlist 1:1, so the
 * authoring experience is faithful even though the numbers are sampled.
 */
import { Badge, Box, Button, HStack } from "@chakra-ui/react";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { Plus } from "react-feather";
import { LuChevronDown } from "react-icons/lu";
import GraphsLayout from "~/components/GraphsLayout";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { Menu } from "~/components/ui/menu";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { DashboardGrid } from "~/components/analytics/charts-proto/DashboardGrid";
import { EmptyState } from "~/components/analytics/charts-proto/EmptyState";
import { QueryBuilderDrawer } from "~/components/analytics/charts-proto/QueryBuilderDrawer";
import type { StubWindow } from "~/components/analytics/charts-proto/stubData";
import { useProtoDashboard } from "~/components/analytics/charts-proto/useProtoDashboard";

function ChartsProtoContent() {
  const { project } = useOrganizationTeamProject();
  const {
    period: { startDate, endDate },
    daysDifference,
  } = usePeriodSelector();

  const dashboard = useProtoDashboard(project?.id ?? "");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = dashboard.widgets.find((w) => w.id === editingId);

  const win: StubWindow = useMemo(
    () => ({ startDate, endDate, days: daysDifference }),
    [startDate, endDate, daysDifference],
  );
  const windowLabel = `${format(startDate, "MMM d")} – ${format(endDate, "MMM d")}`;

  const openAdd = () => {
    setEditingId(null);
    setDrawerOpen(true);
  };
  const openEdit = (id: string) => {
    setEditingId(id);
    setDrawerOpen(true);
  };

  const hasWidgets = dashboard.widgets.length > 0;

  return (
    <GraphsLayout
      title={dashboard.name}
      analyticsHeaderProps={{
        isEditable: true,
        onTitleSave: dashboard.setName,
      }}
      extraHeaderButtons={
        <HStack gap={2}>
          <Badge colorPalette="purple" variant="subtle" size="sm">
            Prototype · sampled data
          </Badge>
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline" size="sm">
                Templates <LuChevronDown />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              {dashboard.templates.map((t) => (
                <Menu.Item
                  key={t.key}
                  value={t.key}
                  onClick={() => dashboard.loadTemplate(t)}
                >
                  {t.name}
                </Menu.Item>
              ))}
              {hasWidgets ? (
                <>
                  <Menu.Separator />
                  <Menu.Item
                    value="clear"
                    color="fg.error"
                    onClick={dashboard.clearAll}
                  >
                    Clear dashboard
                  </Menu.Item>
                </>
              ) : null}
            </Menu.Content>
          </Menu.Root>
          <Button colorPalette="orange" size="sm" onClick={openAdd}>
            <Plus size={16} /> Add widget
          </Button>
        </HStack>
      }
    >
      <Box width="full">
        {hasWidgets ? (
          <DashboardGrid
            widgets={dashboard.widgets}
            window={win}
            projectId={project?.id}
            onReorder={dashboard.reorderWidgets}
            onEdit={openEdit}
            onDuplicate={dashboard.duplicateWidget}
            onDelete={dashboard.removeWidget}
            onResize={dashboard.resizeWidget}
          />
        ) : (
          <EmptyState
            templates={dashboard.templates}
            onPick={dashboard.loadTemplate}
            onBuildOwn={openAdd}
          />
        )}
      </Box>

      <QueryBuilderDrawer
        open={drawerOpen}
        editing={editing}
        window={win}
        windowLabel={windowLabel}
        onClose={() => setDrawerOpen(false)}
        onSave={(spec) => {
          if (editing) {
            dashboard.updateWidget(editing.id, spec);
          } else {
            dashboard.addWidget(spec);
          }
        }}
      />
    </GraphsLayout>
  );
}

export default withPermissionGuard("analytics:view")(ChartsProtoContent);
