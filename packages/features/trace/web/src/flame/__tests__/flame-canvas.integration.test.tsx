// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { FlameCanvas } from "../flame-canvas";
import type { FlameCanvasProps } from "../flame-canvas";

describe("FlameCanvas", () => {
  it("renders the controlled axis and flame layer without owning view state", () => {
    const onClearOnEmpty = vi.fn();
    const props: FlameCanvasProps = {
      flameAreaRef: createRef<HTMLDivElement>(),
      timeAxisRef: createRef<HTMLDivElement>(),
      viewport: { startMs: 0, endMs: 100 },
      fullRange: { startMs: 0, endMs: 100 },
      durationMs: 100,
      fullDurationMs: 100,
      ticks: [{ time: 0, label: "0ms" }],
      relatedSpanIds: null,
      virtualRows: [],
      blocksByDepth: new Map(),
      allNodes: [],
      maxDepth: 0,
      totalHeight: 24,
      spanCount: 0,
      selectedSpanId: null,
      hoveredSpanId: null,
      focusedSpanId: null,
      dimOnHover: false,
      dragSelection: null,
      hiddenSpanCount: 0,
      isZoomed: false,
      onTimeAxisPointerDown: vi.fn(),
      onFlamePointerDown: vi.fn(),
      onClearOnEmpty,
      onSpanClick: vi.fn(),
      onSpanDoubleClick: vi.fn(),
      onHoverChange: vi.fn(),
      onViewport: vi.fn(),
      onResetZoom: vi.fn(),
    };

    render(
      <ChakraProvider value={defaultSystem}>
        <FlameCanvas {...props} />
      </ChakraProvider>,
    );

    expect(document.querySelector(".flame-time-axis")).toBeInTheDocument();
    const flameLayer = document.querySelector('[data-flame-layer="true"]');
    if (!flameLayer) throw new Error("Flame layer was not rendered");

    fireEvent.click(flameLayer);

    expect(onClearOnEmpty).toHaveBeenCalledTimes(1);
  });
});
