/**
 * @vitest-environment jsdom
 * @see specs/licensing/proration-preview.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import { GlobalUpgradeModal } from "../global-upgrade-modal";

const renderGate = (isSaaS: boolean) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <GlobalUpgradeModal isSaaS={isSaaS} />
    </ChakraProvider>,
  );

describe("<GlobalUpgradeModal/>", () => {
  afterEach(() => {
    act(() => {
      useUpgradeModalStore.getState().close();
    });
    cleanup();
  });

  describe("given no variant has been opened", () => {
    it("renders nothing", () => {
      const { container } = renderGate(true);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("when a limit-mode variant opens for a non-SEAT_EVENT limit", () => {
    /** @scenario Existing limit upgrade modal still works for non-SEAT_EVENT limits */
    it("shows the limit title, current usage, and a redirect button to plan management", async () => {
      renderGate(true);

      act(() => {
        useUpgradeModalStore.getState().open("members", 5, 5);
      });

      expect(await screen.findByText("Upgrade Required")).toBeInTheDocument();
      expect(screen.getByText(/team members/i)).toBeInTheDocument();
      expect(screen.getByText("Current usage: 5 / 5")).toBeInTheDocument();
      const link = screen.getByRole("link", { name: "Upgrade Plan" });
      expect(link).toHaveAttribute("href", "/settings/subscription");
    });

    it("links to the license page on a self-hosted deployment", async () => {
      renderGate(false);

      act(() => {
        useUpgradeModalStore.getState().open("members", 5, 5);
      });

      const link = await screen.findByRole("link", { name: "Upgrade License" });
      expect(link).toHaveAttribute("href", "/settings/license");
    });
  });
});
