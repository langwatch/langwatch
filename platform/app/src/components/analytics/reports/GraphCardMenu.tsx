import { Button } from "@chakra-ui/react";
import { Edit, Grid, MoreVertical, Trash2 } from "lucide-react";
import { Menu } from "@langwatch/design-system/menu";
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
  /** The step this workbench card runs at, when it has one stored. */
  granularitySeconds?: number;
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
  granularitySeconds,
  onSizeChange,
  onGranularityChange,
  onDelete,
  isDeleting,
}: GraphCardMenuProps) {
  const router = useRouter();
  const currentSize = getCurrentSize(colSpan, rowSpan);

  // A workbench chart is edited in the workbench that wrote it, not in the
  // builder — the builder cannot read a saved statement.
  //
  // The workbench opens charts through its own toolbar and has no deep-link
  // parameter, so this lands on the surface rather than on the chart. Passing a
  // `?chart=` it does not read would be worse than not passing one: the member
  // would arrive at an empty workbench with a URL claiming otherwise. Opening
  // the named chart directly waits on the workbench accepting a chart id.
  const editUrl = isWorkbenchChart
    ? `/${projectSlug}/analytics/query`
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
            void router.push(editUrl);
          }}
        >
          <Edit /> {isWorkbenchChart ? "Open in workbench" : "Edit Graph"}
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
