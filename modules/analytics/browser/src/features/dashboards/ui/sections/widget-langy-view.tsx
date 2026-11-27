/**
 * A widget opened large from its card's Ask Langy (AC121b): a centred dialog shaped like the card,
 * with Langy usable above its backdrop, so the chart and the conversation about it sit together.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { useWidgetViewSizePx } from "../../behavior/use-widget-view-size.ts";
import type { WidgetViewSize } from "../../model/widget-view-size.ts";

export function WidgetLangyView({
  name,
  description,
  footer,
  actions,
  onClose,
  colSpan,
  rowSpan,
  chart,
}: {
  name: string;
  description?: string;
  /** The card's quiet line, such as the sources its queries count. */
  footer?: string;
  /** The widget's Langy actions; absent when it shows none. */
  actions?: ReactNode;
  onClose: () => void;
  /** The card's spans on the board, which the dialog keeps the shape of. */
  colSpan: number;
  rowSpan: number;
  /** The widget drawn at the given size. */
  chart: (size: WidgetViewSize) => ReactNode;
}) {
  const size = useWidgetViewSizePx({ colSpan, rowSpan });
  return (
    <Dialog
      open
      onClose={onClose}
      title={name}
      {...(description ? { description } : {})}
      size="fit"
      placement="center"
      companion
      cancelLabel={null}
      data-testid="widget-langy-view"
    >
      <VStack align="stretch" gap={3}>
        <Box
          width={`${size.widthPx}px`}
          height={`${size.heightPx}px`}
          flexShrink={0}
          data-testid="widget-langy-view-chart"
        >
          {chart(size)}
        </Box>
        {actions}
        {footer && (
          <Text textStyle="caption" color="fg.subtle">
            {footer}
          </Text>
        )}
      </VStack>
    </Dialog>
  );
}
