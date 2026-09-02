import { Button } from "@chakra-ui/react";
import { Clock, Edit, Grid, MoreVertical, Trash2 } from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS } from "~/features/analytics-query/components/LangWatchQLDashboardWidget";
import {
  describeLangWatchQLGranularityStep,
  LWQL_GRANULARITY_STEPS,
} from "~/server/analytics/lwql/timeWindow";
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
   * Whether this card is a custom-chart-playground widget. Also decides
   * where Edit goes — the playground page, which is the only place a
   * playground widget's sandboxed author code can be edited today.
   */
  isPlaygroundWidget?: boolean;
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
  projectSlug,
  dashboardId,
  colSpan,
  rowSpan,
  isWorkbenchChart = false,
  isPlaygroundWidget = false,
  granularitySeconds,
  onEdit,
  onSizeChange,
  onGranularityChange,
  onDelete,
  isDeleting,
}: GraphCardMenuProps) {
  const router = useRouter();
  const currentSize = getCurrentSize(colSpan, rowSpan);

  // A workbench chart is edited in the workbench that wrote it, and a
  // playground widget in the playground that wrote it — neither the builder
  // nor the other surface can read the other's payload shape.
  //
  // Neither surface opens through a deep-link parameter naming the card, so
  // this lands on the surface rather than on the chart. Passing a parameter
  // neither reads would be worse than not passing one: the member would
  // arrive at an empty surface with a URL claiming otherwise. Opening the
  // named chart/widget directly waits on either surface accepting an id.
  const editUrl = isWorkbenchChart
    ? `/${projectSlug}/analytics/query`
    : isPlaygroundWidget
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
              : isPlaygroundWidget
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

        <Menu.Item value="delete" color="red.600" onClick={onDelete}>
          <Trash2 /> Delete Graph
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export type { SizeOption };
export { getCurrentSize, sizeOptions };
