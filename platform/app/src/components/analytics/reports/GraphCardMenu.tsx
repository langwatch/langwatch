import { Button } from "@chakra-ui/react";
import {
  Clock,
  Edit,
  LayoutDashboard,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS } from "~/features/analytics-query/components/LangWatchQLDashboardWidget";
import {
  describeLangWatchQLGranularityStep,
  LWQL_GRANULARITY_STEPS,
} from "~/server/analytics/lwql/timeWindow";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

/**
 * How each offered datapoint step is named in the menu: the noun form, because
 * a menu item names the step rather than modifying a following word. Shared
 * with the widget's coarsened notice so the two cannot drift apart.
 */
const granularityLabel = (seconds: number): string =>
  describeLangWatchQLGranularityStep(seconds, "noun");

interface GraphCardMenuProps {
  graphId: string;
  projectId: string;
  projectSlug: string;
  dashboardId?: string;
  /**
   * Whether this card is a saved LangWatchQL chart. Decides where Edit goes and
   * whether the datapoint-step picker is offered at all — a builder graph has
   * no granularity contract to pick against.
   */
  isWorkbenchChart?: boolean;
  /**
   * Whether this card is a dashboard widget. Its Edit item runs `onEdit`,
   * which opens the widget's edit drawer in place on the grid.
   */
  isDashboardWidget?: boolean;
  /**
   * Offers "Add to dashboard", which pins a dashboard widget straight to
   * the project's single dashboard (no picker — there's only ever one).
   * Only meaningful alongside `isDashboardWidget`.
   */
  showAddToDashboard?: boolean;
  /** The step this workbench card runs at, when it has one stored. */
  granularitySeconds?: number;
  /**
   * When present, Edit runs this instead of navigating to a chart editor
   * route. A dashboard widget always edits in place, so its card passes this.
   */
  onEdit?: () => void;
  onGranularityChange?: (granularitySeconds: number) => void;
  onDelete: () => void;
  isDeleting: boolean;
}

export function GraphCardMenu({
  graphId,
  projectId,
  projectSlug,
  dashboardId,
  isWorkbenchChart = false,
  isDashboardWidget = false,
  showAddToDashboard = false,
  granularitySeconds,
  onEdit,
  onGranularityChange,
  onDelete,
  isDeleting,
}: GraphCardMenuProps) {
  const router = useRouter();
  const utils = api.useUtils();

  // Resolved lazily (only when the item can actually be shown): the
  // "every project has exactly one dashboard" lookup.
  const dashboard = api.dashboards.getOrCreateFirst.useQuery(
    { projectId },
    { enabled: showAddToDashboard && isDashboardWidget },
  );
  const assignDashboard = api.dashboardWidgets.assignDashboard.useMutation();
  const alreadyOnDashboard =
    !!dashboard.data && dashboardId === dashboard.data.id;

  const handleAddToDashboard = () => {
    if (!dashboard.data) return;
    if (alreadyOnDashboard) {
      toaster.create({
        title: "Already on the dashboard",
        type: "info",
        duration: 3000,
      });
      return;
    }
    assignDashboard.mutate(
      { projectId, id: graphId, dashboardId: dashboard.data.id },
      {
        onSuccess: () => {
          toaster.create({
            title: `Added to ${dashboard.data!.name}`,
            type: "success",
            duration: 3000,
          });
          void utils.dashboardWidgets.list.invalidate({ projectId });
          void utils.graphs.getAll.invalidate();
        },
        onError: () => {
          toaster.create({
            title: "Error adding to dashboard",
            type: "error",
            duration: 3000,
          });
        },
      },
    );
  };

  // Only a builder graph navigates away to edit. A dashboard widget edits in
  // place through `onEdit` (the builder can't read its sandboxed author-code
  // payload), and a saved LangWatchQL chart (isWorkbenchChart) has no editor
  // surface at all anymore and never reaches this; see the Edit item below.
  const builderEditUrl = `/${projectSlug}/analytics/custom/${graphId}${dashboardId ? `?dashboard=${dashboardId}` : ""}`;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" loading={isDeleting}>
          <MoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {/* A saved LangWatchQL chart placed on a dashboard has no editor
            surface anymore (the workbench page was removed) — it stays
            read-only here, rendered via `getById`/`run` same as before. */}
        {!isWorkbenchChart && (
          <Menu.Item
            value="edit"
            onClick={() => {
              if (onEdit) {
                onEdit();
                return;
              }
              void router.push(builderEditUrl);
            }}
          >
            <Edit /> {onEdit || isDashboardWidget ? "Edit" : "Edit Graph"}
          </Menu.Item>
        )}

        {isWorkbenchChart && onGranularityChange && (
          <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
            <Menu.TriggerItem value="granularity">
              <Clock /> Datapoints (
              {granularityLabel(
                granularitySeconds ?? LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS,
              )}
              )
            </Menu.TriggerItem>
            <Menu.Content>
              {LWQL_GRANULARITY_STEPS.map((step) => (
                <Menu.Item
                  key={step}
                  value={String(step)}
                  onClick={() => onGranularityChange(step)}
                >
                  {granularityLabel(step)}
                  {step ===
                    (granularitySeconds ??
                      LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS) && " ✓"}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
        )}

        {isDashboardWidget && showAddToDashboard && (
          <Menu.Item
            value="add-to-dashboard"
            onClick={handleAddToDashboard}
            disabled={!dashboard.data || assignDashboard.isPending}
          >
            <LayoutDashboard /> Add to dashboard
          </Menu.Item>
        )}

        <Menu.Item value="delete" color="red.600" onClick={onDelete}>
          <Trash2 /> Delete Graph
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
