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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { Tooltip } from "@langwatch/design-system/tooltip";

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
      const user = userEvent.setup();
      renderTooltip(
        <TriggerAnchor>
          <button type="button" disabled>
            Add Model Provider
          </button>
        </TriggerAnchor>,
      );

      await user.hover(screen.getByText("Add Model Provider"));

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
