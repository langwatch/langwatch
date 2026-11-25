/**
 * A widget opened large from its card's Ask Langy (AC121b): a drawer that Langy rides beside
 * as it does beside the trace drawer, so the chart and the conversation about it sit together.
 */

import { useInPlaceDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { useFloatingLangyAtOpen } from "../../langy/behavior/use-floating-langy-at-open.ts";

/** The chart's height in the drawer: room to read it, under the drawer's header. */
export const WIDGET_VIEW_CHART_HEIGHT_PX = 440;

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
  useInPlaceDrawer({ open: true });
  const waitForFloatingLangy = useFloatingLangyAtOpen();
  return (
    <Drawer
      open
      onClose={onClose}
      size="xl"
      companionMotion={waitForFloatingLangy ? "wait" : "follow"}
      title={name}
      {...(description ? { subtitle: description } : {})}
      data-testid="widget-langy-view"
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
