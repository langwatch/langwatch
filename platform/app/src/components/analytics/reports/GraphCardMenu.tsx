import { Button } from "@chakra-ui/react";
import {
  Clock,
  Edit,
  Grid,
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

type SizeOption = "1x1" | "2x1" | "1x2" | "2x2";

const sizeOptions: {
  value: SizeOption;
  label: string;
  colSpan: number;
  rowSpan: number;
}[] = [
  { value: "1x1", label: "Small (1x1)", colSpan: 1, rowSpan: 1 },
  { value: "2x1", label: "Wide (2x1)", colSpan: 2, rowSpan: 1 },
  { value: "1x2", label: "Tall (1x2)", colSpan: 1, rowSpan: 2 },
  { value: "2x2", label: "Large (2x2)", colSpan: 2, rowSpan: 2 },
];

/**
 * How each offered datapoint step is named in the menu: the noun form, because
 * a menu item names the step rather than modifying a following word. Shared
 * with the widget's coarsened notice so the two cannot drift apart.
 */
const granularityLabel = (seconds: number): string =>
  describeLangWatchQLGranularityStep(seconds, "noun");

const getCurrentSize = (colSpan: number, rowSpan: number): SizeOption => {
  if (colSpan === 2 && rowSpan === 2) return "2x2";
  if (colSpan === 2 && rowSpan === 1) return "2x1";
  if (colSpan === 1 && rowSpan === 2) return "1x2";
  return "1x1";
};

interface GraphCardMenuProps {
  graphId: string;
  projectId: string;
  projectSlug: string;
  dashboardId?: string;
  colSpan: number;
  rowSpan: number;
  /**
   * Whether this card is a saved LangWatchQL chart. Decides where Edit goes and
   * whether the datapoint-step picker is offered at all — a builder graph has
   * no granularity contract to pick against.
   */
  isWorkbenchChart?: boolean;
  /**
   * Whether this card is a dashboard widget. Also decides
   * where Edit goes — the playground page, which is the only place a
   * dashboard widget's sandboxed author code can be edited today.
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
   * route — used by surfaces (e.g. the playground) that edit a card in place.
   */
  onEdit?: () => void;
  onSizeChange: (size: SizeOption) => void;
  onGranularityChange?: (granularitySeconds: number) => void;
  onDelete: () => void;
  isDeleting: boolean;
}

export function GraphCardMenu({
  graphId,
  projectId,
  projectSlug,
  dashboardId,
  colSpan,
  rowSpan,
  isWorkbenchChart = false,
  isDashboardWidget = false,
  showAddToDashboard = false,
  granularitySeconds,
  onEdit,
  onSizeChange,
  onGranularityChange,
  onDelete,
  isDeleting,
}: GraphCardMenuProps) {
  const router = useRouter();
  const currentSize = getCurrentSize(colSpan, rowSpan);
  const utils = api.useUtils();

  // Resolved lazily (only when the item can actually be shown) — the same
  // "every project has exactly one dashboard" lookup the playground page
  // itself uses to pre-assign new widgets.
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

  // A workbench chart is edited in the workbench that wrote it, and a
  // dashboard widget in the playground that wrote it — neither the builder
  // nor the other surface can read the other's payload shape.
  //
  // Neither surface opens through a deep-link parameter naming the card, so
  // this lands on the surface rather than on the chart. Passing a parameter
  // neither reads would be worse than not passing one: the member would
  // arrive at an empty surface with a URL claiming otherwise. Opening the
  // named chart/widget directly waits on either surface accepting an id.
  const editUrl = isWorkbenchChart
    ? `/${projectSlug}/analytics/query`
    : isDashboardWidget
      ? `/${projectSlug}/dev/custom-chart-playground`
      : `/${projectSlug}/analytics/custom/${graphId}${dashboardId ? `?dashboard=${dashboardId}` : ""}`;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" loading={isDeleting}>
          <MoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="edit"
          onClick={() => {
            if (onEdit) {
              onEdit();
              return;
            }
            void router.push(editUrl);
          }}
        >
          <Edit />{" "}
          {onEdit
            ? "Edit"
            : isWorkbenchChart
              ? "Open in workbench"
              : isDashboardWidget
                ? "Open in playground"
                : "Edit Graph"}
        </Menu.Item>

        <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
          <Menu.TriggerItem value="size">
            <Grid /> Size ({currentSize})
          </Menu.TriggerItem>
          <Menu.Content>
            {sizeOptions.map((option) => (
              <Menu.Item
                key={option.value}
                value={option.value}
                onClick={() => onSizeChange(option.value)}
              >
                {option.label}
                {option.value === currentSize && " ✓"}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>

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

export type { SizeOption };
export { getCurrentSize, sizeOptions };
