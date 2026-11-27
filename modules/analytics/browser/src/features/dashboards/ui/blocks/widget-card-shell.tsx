/**
 * A board card's chrome: its name, a faint info tip, then Ask Langy and the board's controls
 * (on hover or focus, always without hover, so a board stays calm), its body, its Langy actions
 * and a quiet footer line. A widget frame in the body publishes what its data is missing here.
 */

import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { WidgetCompletenessSinkContext } from "../../../../behavior/widget-completeness-sink.ts";
import {
  completenessNotes,
  sampleNote,
  type WidgetCompleteness,
} from "../../../../model/dashboard-widget/widget-completeness.ts";
import { boardCardHeightPx } from "../../model/board-grid.ts";
import { WIDGET_ACTION_ROW_HEIGHT_PX } from "./widget-action-row.tsx";
import { WidgetInfoTip } from "./widget-info-tip.tsx";

/** The title row's least height: its top padding and one 24px row of controls. */
const HEADER_HEIGHT_PX = 34;
/** The footer line's height: one caption line and its bottom padding. */
const FOOTER_HEIGHT_PX = 22;
/** The room the title row, the footer, the body's bottom padding and the border take. */
const CARD_CHROME_PX = HEADER_HEIGHT_PX + FOOTER_HEIGHT_PX + 8 + 2;

/**
 * The height a card's body may take at `rowSpan` board rows, less its action row if it has one,
 * with a one-line title: the first guess, before the card measured the room its body has.
 */
export function widgetBodyHeightPx(rowSpan: number, { withActions = false } = {}): number {
  const actions = withActions ? WIDGET_ACTION_ROW_HEIGHT_PX : 0;
  return Math.max(boardCardHeightPx(rowSpan) - CARD_CHROME_PX - actions, 60);
}

export function WidgetCardShell({
  name,
  description,
  ask,
  controls,
  actions,
  footer,
  viewRef,
  children,
}: {
  name: string;
  description?: string;
  /** Ask Langy, first of the hover controls; absent without Langy. */
  ask?: ReactNode;
  /** The widget's Langy actions, a row under the body; absent when it declares none. */
  actions?: ReactNode;
  /** Absent when the widget offers no action, as on a read-only board without Langy. */
  controls?: ReactNode;
  /** One quiet line under the body, such as the sources its queries count. */
  footer?: string;
  /** Told the card's root, so a caller can tell when it is on screen. */
  viewRef?: (node: HTMLElement | null) => void;
  /** Or, told the body's measured height once known, so a chart fits between title and footer. */
  children: ReactNode | ((bodyHeightPx: number | undefined) => ReactNode);
}) {
  const [completeness, setCompleteness] = useState<WidgetCompleteness | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const [bodyHeightPx, setBodyHeightPx] = useState<number | undefined>(void 0);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    // The body takes what the title, actions and footer leave, whatever it holds.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBodyHeightPx(Math.floor(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const hasNotes =
    completenessNotes(completeness).length > 0 || sampleNote(completeness) !== undefined;
  return (
    <VStack
      ref={viewRef}
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
      boxShadow="xs"
    >
      {/* A narrow card wraps its title to a second line, which the body gives up room for. */}
      <HStack
        minHeight={`${HEADER_HEIGHT_PX}px`}
        flexShrink={0}
        alignItems="flex-start"
        paddingTop="10px"
        paddingLeft={4}
        paddingRight={2}
        gap={1}
      >
        <Text
          minWidth={0}
          lineClamp={2}
          wordBreak="break-word"
          textStyle="label"
          title={name}
          data-testid="widget-card-title"
        >
          {name}
        </Text>
        {(description || hasNotes) && (
          <WidgetInfoTip name={name} description={description} completeness={completeness} />
        )}
        {(ask || controls) && (
          <HStack
            gap={0.5}
            marginLeft="auto"
            flexShrink={0}
            data-testid="widget-card-controls"
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
            {ask}
            {controls}
          </HStack>
        )}
      </HStack>
      <Box ref={body} flex={1} minHeight={0} paddingX={2} paddingBottom={2}>
        <WidgetCompletenessSinkContext.Provider value={setCompleteness}>
          {typeof children === "function" ? children(bodyHeightPx) : children}
        </WidgetCompletenessSinkContext.Provider>
      </Box>
      {actions}
      {footer && (
        <Text
          height={`${FOOTER_HEIGHT_PX}px`}
          paddingX={4}
          paddingBottom={1.5}
          textStyle="caption"
          color="fg.subtle"
          truncate
          title={footer}
          data-testid="widget-card-footer"
        >
          {footer}
        </Text>
      )}
    </VStack>
  );
}
