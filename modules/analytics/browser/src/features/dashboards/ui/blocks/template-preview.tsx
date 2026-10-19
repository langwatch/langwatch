/**
 * A template card's preview: the top of its board as a captured image in the theme in use, or
 * faint blocks where its widgets sit. Decoration only: no query, no focus. Its top margin takes
 * up the slack, so previews line up when a name or job is shorter than its neighbours'.
 */

import { useColorMode } from "@langwatch/design-system/color-mode";
import { Box, Grid, HStack, Image } from "@langwatch/design-system/primitives";
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
      return <Box width="38%" height="44px" borderRadius="md" background="bg.muted" />;
    case "line":
      return (
        <Box color="border.emphasized" height="full">
          <svg viewBox="0 0 100 40" width="100%" height="100%" preserveAspectRatio="none">
            <polyline
              points="0,30 15,24 30,27 45,15 60,19 75,9 100,13"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </Box>
      );
    case "bars":
      return (
        <HStack align="end" gap={3} height="full">
          {BAR_HEIGHTS.map((height, index) => (
            <Box key={index} flex={1} height={height} borderRadius="md" background="bg.muted" />
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
      gap={4}
      padding={6}
    >
      {widgets.map(({ key, placeholder, layout }) => (
        <Box
          key={key}
          data-sketch-widget={key}
          gridColumn={`${layout.gridColumn + 1} / span ${layout.colSpan}`}
          gridRow={`${layout.gridRow + 1} / span ${layout.rowSpan}`}
          display="flex"
          flexDirection="column"
          gap={5}
          padding={6}
          borderWidth="2px"
          borderColor="border.muted"
          borderRadius="2xl"
          background="bg.panel"
          overflow="hidden"
        >
          <Box width="45%" height="14px" flexShrink={0} borderRadius="full" background="bg.muted" />
          <Box flex={1} minHeight={0}>
            <Placeholder kind={placeholder} />
          </Box>
        </Box>
      ))}
    </Grid>
  );
}

export function TemplatePreview({ preview }: { preview: Preview }) {
  const { colorMode } = useColorMode();
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
      height="144px"
      marginTop="auto"
      flexShrink={0}
      overflow="hidden"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      background="bg.subtle"
      pointerEvents="none"
      userSelect="none"
    >
      {preview.kind === "image" ? (
        <Image
          src={preview.src[colorMode]}
          alt=""
          loading="lazy"
          decoding="async"
          display="block"
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
    </Box>
  );
}
