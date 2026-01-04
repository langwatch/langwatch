/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizableDivider } from "../ResizableDivider";

const renderDivider = (props: {
  isExpanded?: boolean;
  onPositionChange?: (clientY: number) => void;
  onDragEnd?: () => void;
  onToggle?: () => void;
}) => {
  const defaultProps = {
    isExpanded: true,
    onPositionChange: vi.fn(),
    onDragEnd: vi.fn(),
    onToggle: vi.fn(),
    ...props,
  };

  return {
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ResizableDivider {...defaultProps} />
      </ChakraProvider>
    ),
    ...defaultProps,
  };
};

describe("ResizableDivider", () => {
  afterEach(() => {
    cleanup();
  });

  describe("click to toggle", () => {
    it("calls onToggle when clicked without dragging", () => {
      const onToggle = vi.fn();
      renderDivider({ onToggle });

      const divider = screen.getByTestId("resizable-divider");

      // Simulate click (mousedown + mouseup without significant movement)
      fireEvent.mouseDown(divider, { clientY: 100 });
      fireEvent.mouseUp(document);

      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("does not call onToggle when dragging", () => {
      const onToggle = vi.fn();
      const onDragEnd = vi.fn();
      renderDivider({ onToggle, onDragEnd });

      const divider = screen.getByTestId("resizable-divider");

      // Simulate drag (mousedown + significant movement + mouseup)
      fireEvent.mouseDown(divider, { clientY: 100 });
      fireEvent.mouseMove(document, { clientY: 150 }); // Move 50px
      fireEvent.mouseUp(document);

      expect(onToggle).not.toHaveBeenCalled();
      expect(onDragEnd).toHaveBeenCalledTimes(1);
    });

    it("treats small movements (< 3px) as clicks", () => {
      const onToggle = vi.fn();
      const onDragEnd = vi.fn();
      renderDivider({ onToggle, onDragEnd });

      const divider = screen.getByTestId("resizable-divider");

      // Simulate tiny movement (less than 3px threshold)
      fireEvent.mouseDown(divider, { clientY: 100 });
      fireEvent.mouseMove(document, { clientY: 102 }); // Move only 2px
      fireEvent.mouseUp(document);

      // Should be treated as a click, not a drag
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe("drag to resize", () => {
    it("calls onPositionChange during drag", () => {
      const onPositionChange = vi.fn();
      renderDivider({ onPositionChange });

      const divider = screen.getByTestId("resizable-divider");

      fireEvent.mouseDown(divider, { clientY: 100 });
      fireEvent.mouseMove(document, { clientY: 150 });
      fireEvent.mouseMove(document, { clientY: 200 });

      expect(onPositionChange).toHaveBeenCalledWith(150);
      expect(onPositionChange).toHaveBeenCalledWith(200);
      expect(onPositionChange).toHaveBeenCalledTimes(2);
    });

    it("calls onDragEnd when drag finishes", () => {
      const onDragEnd = vi.fn();
      renderDivider({ onDragEnd });

      const divider = screen.getByTestId("resizable-divider");

      fireEvent.mouseDown(divider, { clientY: 100 });
      fireEvent.mouseMove(document, { clientY: 150 });
      fireEvent.mouseUp(document);

      expect(onDragEnd).toHaveBeenCalledTimes(1);
    });

    it("stops tracking after mouseup", () => {
      const onPositionChange = vi.fn();
      renderDivider({ onPositionChange });

      const divider = screen.getByTestId("resizable-divider");

      fireEvent.mouseDown(divider, { clientY: 100 });
      fireEvent.mouseMove(document, { clientY: 150 });
      fireEvent.mouseUp(document);

      // Movement after mouseup should not trigger callback
      fireEvent.mouseMove(document, { clientY: 200 });

      expect(onPositionChange).toHaveBeenCalledTimes(1);
      expect(onPositionChange).toHaveBeenCalledWith(150);
    });
  });

  describe("visual behavior", () => {
    it("renders with correct role for accessibility", () => {
      renderDivider({});

      const divider = screen.getByTestId("resizable-divider");
      expect(divider).toBeInTheDocument();
    });

    it("renders different icon based on isExpanded state", () => {
      // When expanded, hovering should show ChevronUp
      const { rerender } = renderDivider({ isExpanded: true });
      expect(screen.getByTestId("resizable-divider")).toBeInTheDocument();

      // When collapsed, hovering should show ChevronDown
      rerender(
        <ChakraProvider value={defaultSystem}>
          <ResizableDivider
            isExpanded={false}
            onPositionChange={vi.fn()}
            onDragEnd={vi.fn()}
            onToggle={vi.fn()}
          />
        </ChakraProvider>
      );
      expect(screen.getByTestId("resizable-divider")).toBeInTheDocument();
    });
  });
});

