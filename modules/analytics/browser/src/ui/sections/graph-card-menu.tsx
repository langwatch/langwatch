import {
  describeLangWatchQLGranularityStep,
  LWQL_GRANULARITY_STEPS,
} from "@langwatch/analytics-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Button } from "@langwatch/design-system/primitives";
import { Clock, Edit, MoreVertical, Trash2 } from "lucide-react";

import { LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS } from "../../features/dashboard-widget/ui/sections/langwatch-ql-dashboard-widget.tsx";
import { useAnalyticsHost } from "../../model/analytics-host.ts";

/**
 * How each offered datapoint step is named in the menu: the noun form, because
 * a menu item names the step rather than modifying a following word. Shared
 * with the widget's coarsened notice so the two cannot drift apart.
 */
const granularityLabel = (seconds: number): string =>
  describeLangWatchQLGranularityStep(seconds, "noun");

interface GraphCardMenuProps {
  graphId: string;
  projectSlug: string;
  dashboardId?: string;
  /**
   * Whether this card is a saved LangWatchQL chart. Decides where Edit goes and
   * whether the datapoint-step picker is offered at all — a builder graph has
   * no granularity contract to pick against.
   */
  isWorkbenchChart?: boolean;
  /** The step this workbench card runs at, when it has one stored. */
  granularitySeconds?: number;
  onGranularityChange?: (granularitySeconds: number) => void;
  onDelete: () => void;
  isDeleting: boolean;
}

export function GraphCardMenu({
  graphId,
  projectSlug,
  dashboardId,
  isWorkbenchChart = false,
  granularitySeconds,
  onGranularityChange,
  onDelete,
  isDeleting,
}: GraphCardMenuProps) {
  const host = useAnalyticsHost();

  // Only a builder graph edits: a saved LangWatchQL chart has no editor surface anymore.
  const builderEditUrl = `/${projectSlug}/analytics/custom/${graphId}${dashboardId ? `?dashboard=${dashboardId}` : ""}`;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          loading={isDeleting}
          aria-label="Chart actions"
          data-testid="analytics-chart-menu"
        >
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
            data-testid="analytics-chart-edit"
            onClick={() => host.navigate(builderEditUrl)}
          >
            <Edit /> Edit graph
          </Menu.Item>
        )}

        {isWorkbenchChart && onGranularityChange && (
          <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
            <Menu.TriggerItem value="granularity">
              <Clock /> Datapoints (
              {granularityLabel(granularitySeconds ?? LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS)})
            </Menu.TriggerItem>
            <Menu.Content>
              {LWQL_GRANULARITY_STEPS.map((step) => (
                <Menu.Item
                  key={step}
                  value={String(step)}
                  onClick={() => onGranularityChange(step)}
                >
                  {granularityLabel(step)}
                  {step === (granularitySeconds ?? LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS) && " ✓"}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
        )}

        <Menu.Item
          value="delete"
          color="red.fg"
          data-testid="analytics-chart-delete"
          onClick={onDelete}
        >
          <Trash2 /> Delete Graph
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
