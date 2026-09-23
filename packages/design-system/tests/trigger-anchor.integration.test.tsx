// @vitest-environment jsdom
/**
 * TriggerAnchor + Tooltip: verify tooltip opens when wrapped. Uses real
 * components to catch asChild prop-passing failures.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tooltip } from "../src/components/tooltip.tsx";
import { TriggerAnchor } from "../src/components/trigger-anchor.tsx";

const REASON = "Create a project first to add a model provider.";

function renderTooltip(children: React.ReactNode) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Tooltip content={REASON} openDelay={0} closeDelay={0}>
        {children}
      </Tooltip>
    </ChakraProvider>,
  );
}

describe("given a tooltip wrapped around a trigger anchor", () => {
  describe("when the pointer rests on the control", () => {
    it("shows the reason the control cannot be used", async () => {
      renderTooltip(
        <TriggerAnchor>
          <button type="button" disabled>
            Add Model Provider
          </button>
        </TriggerAnchor>,
      );

      // The tooltip opens on pointer entry. Driven with the DOM events Ark
      // actually listens for rather than a user-event session, which is the
      // shape every other suite in this package uses.
      const control = screen.getByText("Add Model Provider");
      fireEvent.pointerMove(control, { pointerType: "mouse" });
      fireEvent.pointerEnter(control, { pointerType: "mouse" });
      fireEvent.mouseEnter(control);
      fireEvent.mouseOver(control);

      await waitFor(() => {
        expect(screen.getAllByText(REASON).length).toBeGreaterThan(0);
      });
    });
  });

  describe("when the anchor receives props from the tooltip trigger", () => {
    it("passes them through to a real element instead of swallowing them", () => {
      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <TriggerAnchor id="anchor-under-test" data-scope="tooltip">
            <button type="button">Add Model Provider</button>
          </TriggerAnchor>
        </ChakraProvider>,
      );

      const anchor = container.querySelector("#anchor-under-test");

      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute("data-scope")).toBe("tooltip");
    });
  });
});
