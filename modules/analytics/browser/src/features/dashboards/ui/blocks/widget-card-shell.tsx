/**
 * A board card's chrome: its name and a faint info tip, the controls a board gives it (shown
 * only on hover or focus, so a board of cards stays calm), then its body. A widget frame in the
 * body publishes what its data is missing here, and the info tip says it.
 */

import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { type ReactNode, useState } from "react";

import { WidgetCompletenessSinkContext } from "../../../../behavior/widget-completeness-sink.ts";
import {
  completenessNotes,
  type WidgetCompleteness,
} from "../../../../model/dashboard-widget/widget-completeness.ts";
import { boardCardHeightPx } from "../../model/board-grid.ts";
import { WidgetInfoTip } from "./widget-info-tip.tsx";

/** The title row's height: its top padding and one 24px row of controls. */
const HEADER_HEIGHT_PX = 34;
/** The room the title row, the body's bottom padding and the border take from a card. */
const CARD_CHROME_PX = HEADER_HEIGHT_PX + 8 + 2;

/** The height a card's body may take at `rowSpan` board rows. */
export function widgetBodyHeightPx(rowSpan: number): number {
  return Math.max(boardCardHeightPx(rowSpan) - CARD_CHROME_PX, 60);
}

export function WidgetCardShell({
  name,
  description,
  controls,
  children,
}: {
  name: string;
  description?: string;
  /** Absent on a read-only board. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  const [completeness, setCompleteness] = useState<WidgetCompleteness | null>(null);
  const hasNotes = completenessNotes(completeness).length > 0;
  return (
    <VStack
      className="group"
      position="relative"
      align="stretch"
      gap={0}
      height="full"
      minWidth={0}
      overflow="hidden"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.04)"
    >
      <HStack
        height={`${HEADER_HEIGHT_PX}px`}
        paddingTop="10px"
        paddingLeft={4}
        paddingRight={2}
        gap={1}
      >
        <Text minWidth={0} truncate fontSize="13px" lineHeight="20px" fontWeight="medium">
          {name}
        </Text>
        {(description || hasNotes) && (
          <WidgetInfoTip name={name} description={description} completeness={completeness} />
        )}
        {controls && (
          <HStack
            gap={0.5}
            marginLeft="auto"
            flexShrink={0}
            opacity={0}
            transition="opacity 0.15s"
            _groupHover={{ opacity: 1 }}
            _groupFocusWithin={{ opacity: 1 }}
            css={{
              // An open menu moves focus out of the card; keep its trigger in view meanwhile.
              "&:has([aria-expanded=true])": { opacity: 1 },
              "@media (hover: none)": { opacity: 1 },
            }}
          >
            {controls}
          </HStack>
        )}
      </HStack>
      <Box flex={1} minHeight={0} paddingX={2} paddingBottom={2}>
        <WidgetCompletenessSinkContext.Provider value={setCompleteness}>
          {children}
        </WidgetCompletenessSinkContext.Provider>
      </Box>
    </VStack>
  );
}
