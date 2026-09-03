// @vitest-environment jsdom
/**
 * A tooltip wrapped around a TriggerAnchor has to actually open.
 *
 * TriggerAnchor exists to give nested asChild clones their own DOM node, and
 * `asChild` delivers the trigger's id, data attributes, handlers and ref as
 * ordinary props. A version that accepted only `children` dropped all of it
 * and the tooltip never opened, with no error and no warning to show for it,
 * so every disabled control explaining itself through a tooltip was mute.
 *
 * This renders the real Tooltip against the real TriggerAnchor. Mocking the
 * Tooltip here would hide exactly the defect the test exists to catch.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TriggerAnchor } from "../src/components/trigger-anchor";
import { Tooltip } from "../src/components/tooltip";

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
