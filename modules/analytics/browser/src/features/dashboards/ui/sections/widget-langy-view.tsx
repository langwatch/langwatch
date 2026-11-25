/**
 * A widget opened large from its card's Ask Langy (AC121b): a drawer from the left that stops
 * short of Langy's dock, so the chart and the conversation about it sit side by side.
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import { LANGY_DOCK_WIDTH_PX } from "@langwatch/langy-contract";
import type { ReactNode } from "react";

import { useReservedEndInset } from "../../../dashboard-widget/ui/sections/dashboard-widget-edit-drawer.tsx";

/** The chart's height in the drawer: room to read it, under the drawer's header. */
export const WIDGET_VIEW_CHART_HEIGHT_PX = 440;

/** Langy's dock plus the drawer's own inset and a gap, so the two sit side by side. */
const BESIDE_LANGY_PX = LANGY_DOCK_WIDTH_PX + 24;

export function WidgetLangyView({
  name,
  description,
  footer,
  actions,
  onClose,
  chart,
}: {
  name: string;
  description?: string;
  /** The card's quiet line, such as the sources its queries count. */
  footer?: string;
  /** The widget's Langy actions; absent when it shows none. */
  actions?: ReactNode;
  onClose: () => void;
  /** The widget drawn at `WIDGET_VIEW_CHART_HEIGHT_PX`. */
  chart: ReactNode;
}) {
  useReservedEndInset({ open: true, reserveEndPx: BESIDE_LANGY_PX });
  return (
    <Drawer
      open
      onClose={onClose}
      size="xl"
      placement="start"
      companionMotion="follow"
      title={name}
      {...(description ? { subtitle: description } : {})}
    >
      <VStack align="stretch" gap={3}>
        <Box height={`${WIDGET_VIEW_CHART_HEIGHT_PX}px`} data-testid="widget-langy-view-chart">
          {chart}
        </Box>
        {actions}
        {footer && (
          <Text textStyle="caption" color="fg.subtle">
            {footer}
          </Text>
        )}
        <Text textStyle="sm" color="fg.muted">
          Ask Langy about this chart in the panel beside it, or click a bar, point or row to ask
          about that value.
        </Text>
      </VStack>
    </Drawer>
  );
}
