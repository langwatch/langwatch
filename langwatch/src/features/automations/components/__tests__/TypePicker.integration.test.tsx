/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { TriggerAction } from "@prisma/client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypePicker } from "../TypePicker";

// Transitive: provider ConfigForms import ~/utils/api at module scope.
// TypePicker itself never touches tRPC, so an empty shape suffices.
vi.mock("~/utils/api", () => ({
  api: { useContext: () => ({}) },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderPicker = (props: Partial<Parameters<typeof TypePicker>[0]> = {}) =>
  render(
    <TypePicker value={null} onChange={vi.fn()} source="trace" {...props} />,
    { wrapper: Wrapper },
  );

describe("TypePicker", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the draft source is customGraph", () => {
    it("disables the action-category cards", () => {
      renderPicker({ source: "customGraph" });

      const dataset = screen.getByRole("button", { name: /add to dataset/i });
      const annotation = screen.getByRole("button", {
        name: /add to annotation queue/i,
      });
      expect(dataset).toHaveAttribute("aria-disabled", "true");
      expect(annotation).toHaveAttribute("aria-disabled", "true");
    });

    it("keeps the notify cards enabled", () => {
      renderPicker({ source: "customGraph" });

      expect(
        screen.getByRole("button", { name: /email/i }),
      ).not.toHaveAttribute("aria-disabled");
      expect(
        screen.getByRole("button", { name: /slack/i }),
      ).not.toHaveAttribute("aria-disabled");
    });

    describe("when a disabled action card is clicked", () => {
      it("does not call onChange", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderPicker({ source: "customGraph", onChange });

        await user.click(
          screen.getByRole("button", { name: /add to dataset/i }),
        );

        expect(onChange).not.toHaveBeenCalled();
      });
    });

    describe("when a disabled action card is hovered", () => {
      it("explains that graph alerts only notify", async () => {
        const user = userEvent.setup();
        renderPicker({ source: "customGraph" });

        await user.hover(
          screen.getByRole("button", { name: /add to dataset/i }),
        );

        await waitFor(() => {
          expect(
            screen.getAllByText(
              /graph alerts only support email and slack notifications/i,
            ).length,
          ).toBeGreaterThan(0);
        });
      });
    });
  });

  describe("given the draft source is trace", () => {
    describe("when an action card is clicked", () => {
      it("calls onChange with the picked action", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderPicker({ source: "trace", onChange });

        const dataset = screen.getByRole("button", {
          name: /add to dataset/i,
        });
        expect(dataset).not.toHaveAttribute("aria-disabled");
        await user.click(dataset);

        expect(onChange).toHaveBeenCalledWith(TriggerAction.ADD_TO_DATASET);
      });
    });
  });
});
