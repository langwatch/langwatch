/**
 * @vitest-environment jsdom
 * @see specs/licensing/proration-preview.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import { GlobalUpgradeModal } from "../global-upgrade-modal.tsx";

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

  describe("when a lite member reaches something their seat does not open", () => {
    const openRestriction = () =>
      act(() => {
        useUpgradeModalStore.getState().openLiteMemberRestriction({ resource: "scenarios" });
      });

    /** @scenario "Restriction modal uses role-based messaging" */
    it("explains the role limit without mentioning plans, billing or upgrades", async () => {
      renderGate(true);
      openRestriction();

      expect(await screen.findByText("Feature Not Available")).toBeInTheDocument();
      expect(
        screen.getAllByText(
          "This feature is not available for your current role. Contact your organization admin for access.",
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(/plan/i)).toBeNull();
      expect(screen.queryByText(/billing/i)).toBeNull();
      expect(screen.queryByText(/pricing/i)).toBeNull();
      expect(screen.queryByText(/upgrade/i)).toBeNull();
    });

    /** @scenario Restriction modal offers "Contact Admin" not "Upgrade your plan" */
    it("offers no way to buy a bigger plan out of it", async () => {
      renderGate(true);
      openRestriction();

      expect(await screen.findByText("Feature Not Available")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /upgrade/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /manage plan/i })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Dismiss" }).length).toBeGreaterThan(0);
    });
  });

  describe("when a seat update waits to be confirmed and nothing fills the price slot", () => {
    it("says seat management is unavailable rather than rendering an empty dialog", async () => {
      renderGate(true);

      act(() => {
        useUpgradeModalStore.getState().openSeats({
          organizationId: "org-1",
          currentSeats: 5,
          newSeats: 7,
          onConfirm: () => Promise.resolve(),
        });
      });

      expect(
        await screen.findByText("Seat management is not available in this deployment."),
      ).toBeInTheDocument();
    });
  });
});
