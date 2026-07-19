/**
 * @vitest-environment jsdom
 *
 * Header-layout + affordance coverage for SidebarSection:
 * - the drag grip is lifted out of the in-flow header so the section icon +
 *   title line up with the value rows beneath (one cohesive left-aligned
 *   block) rather than sitting ~38px to their right (T20);
 * - the per-section value filter toggle reads as "filter THESE values"
 *   (list-filter funnel), not the global search bar (T16).
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { Activity } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { SidebarSection } from "../SidebarSection";

afterEach(() => {
  cleanup();
});

const renderSection = (
  props: Partial<React.ComponentProps<typeof SidebarSection>> = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SidebarSection title="STATUS" icon={Activity} open {...props}>
        <div data-testid="section-body">body</div>
      </SidebarSection>
    </ChakraProvider>,
  );

describe("<SidebarSection /> header", () => {
  describe("given the section is sortable (drag handle present)", () => {
    it("lifts the grip out of the in-flow header so the icon + title align with the rows below", () => {
      renderSection({
        dragHandleProps: {
          role: "button",
        } as React.HTMLAttributes<HTMLDivElement>,
      });

      const grip = screen.getByLabelText(/Reorder STATUS/i);
      // Out of flow: the grip lives in the left gutter as an absolute overlay
      // so it no longer pushes the icon + title to the right of the value rows.
      expect(grip).toHaveStyle({ position: "absolute" });
    });

    it("still renders the section title", () => {
      renderSection({
        dragHandleProps: {
          role: "button",
        } as React.HTMLAttributes<HTMLDivElement>,
      });

      expect(screen.getByText("STATUS")).toBeInTheDocument();
    });
  });

  describe("given the section exposes a value search toggle", () => {
    it("labels it as searching THIS section's values", () => {
      renderSection({
        searchToggleProps: { open: false, onToggle: vi.fn() },
      });

      expect(screen.getByLabelText("Search STATUS values")).toBeInTheDocument();
    });

    it("flips the label to a hide affordance once the value search is open", () => {
      renderSection({
        searchToggleProps: { open: true, onToggle: vi.fn() },
      });

      expect(
        screen.getByLabelText("Hide STATUS value search"),
      ).toBeInTheDocument();
    });
  });
});
