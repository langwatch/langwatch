/**
 * A template card's preview: the template's real board as a captured image, or, until one is
 * captured, its widgets sketched at their grid places. Either way it is decoration, runs no
 * query and cannot be focused; the board is laid out wide and scaled to the card.
 */

import { Box, Grid, HStack, Image, Text } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

import { CHART_GRID_COLUMNS } from "../../../../model/chart-grid.ts";
import type {
  PreviewPlaceholder,
  PreviewWidget,
  TemplatePreview as Preview,
} from "../../model/template-library.ts";

/** The width the sketch lays the board out at before it is scaled to the card. */
const BOARD_WIDTH = 920;
const ROW_HEIGHT = 44;
const BAR_HEIGHTS = ["40%", "70%", "55%", "90%", "65%", "80%"];

function Placeholder({ kind }: { kind: PreviewPlaceholder }) {
  switch (kind) {
    case "tile":
      return <Box width="96px" height="36px" borderRadius="md" background="bg.muted" />;
    case "line":
      return (
        <Box color="fg.subtle" opacity={0.5} height="full">
          <svg viewBox="0 0 100 40" width="100%" height="100%" preserveAspectRatio="none">
            <polyline
              points="0,30 15,24 30,27 45,15 60,19 75,9 100,13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </Box>
      );
    case "bars":
      return (
        <HStack align="end" gap={2} height="full">
          {BAR_HEIGHTS.map((height, index) => (
            <Box key={index} flex={1} height={height} borderRadius="sm" background="bg.muted" />
          ))}
        </HStack>
      );
  }
}

function LayoutSketch({ widgets }: { widgets: readonly PreviewWidget[] }) {
  return (
    <Grid
      templateColumns={`repeat(${CHART_GRID_COLUMNS}, 1fr)`}
      gridAutoRows={`${ROW_HEIGHT}px`}
      gap={3}
      padding={4}
    >
      {widgets.map(({ key, title, placeholder, layout }) => (
        <Box
          key={key}
          gridColumn={`${layout.gridColumn + 1} / span ${layout.colSpan}`}
          gridRow={`${layout.gridRow + 1} / span ${layout.rowSpan}`}
          display="flex"
          flexDirection="column"
          gap={3}
          padding={4}
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          background="bg.panel"
          overflow="hidden"
        >
          <Text fontSize="15px" fontWeight="semibold" color="fg.muted" truncate>
            {title}
          </Text>
          <Box flex={1} minHeight={0}>
            <Placeholder kind={placeholder} />
          </Box>
        </Box>
      ))}
    </Grid>
  );
}

export function TemplatePreview({ preview }: { preview: Preview }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.36);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / BOARD_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Box
      ref={box}
      aria-hidden
      inert
      position="relative"
      height="230px"
      overflow="hidden"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg.subtle"
      pointerEvents="none"
      userSelect="none"
    >
      {preview.kind === "image" ? (
        <Image
          src={preview.src}
          alt=""
          width="full"
          height="full"
          objectFit="cover"
          objectPosition="top"
        />
      ) : (
        <Box width={`${BOARD_WIDTH}px`} transform={`scale(${scale})`} transformOrigin="top left">
          <LayoutSketch widgets={preview.widgets} />
        </Box>
      )}
      <Box
        position="absolute"
        insetX={0}
        bottom={0}
        height={12}
        bgGradient="to-t"
        gradientFrom="bg.panel"
        gradientTo="transparent"
      />
    </Box>
  );
}
