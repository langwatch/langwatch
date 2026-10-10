/**
 * @vitest-environment jsdom
 * @see specs/licensing/proration-preview.feature
 */
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import { uiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  SeatProrationPreviewToken,
  type SeatProrationPreviewProps,
} from "@langwatch/enterprise-billing-client";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUpgradeModalStore } from "../../../../model/upgrade-modal-store.ts";
import { GlobalUpgradeModal } from "../global-upgrade-modal.tsx";

const renderGate = (isSaaS: boolean) =>
  renderWithDesignSystem(<GlobalUpgradeModal isSaaS={isSaaS} />);

/** Billing's price, as its declaration lends it; it only names the seats it was handed. */
function LentPrice({ variant }: SeatProrationPreviewProps) {
  return <p>Priced {variant.newSeats} seats</p>;
}

const billingLendsThePrice = {
  ...createUiHostServicesFromHost({ route: () => ({ params: {}, query: {} }), navigate: () => {} }),
  declarations: uiDeclarations([
    {
      name: "billing",
      installation: {
        capabilities: {},
        lends: [{ token: SeatProrationPreviewToken, load: async () => ({ default: LentPrice }) }],
      },
    },
  ]),
};

const openSevenSeats = () =>
  act(() => {
    useUpgradeModalStore.getState().openSeats({
      organizationId: "org-1",
      currentSeats: 5,
      newSeats: 7,
      onConfirm: () => Promise.resolve(),
    });
  });

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

      expect(await screen.findByText("Upgrade required")).toBeInTheDocument();
      expect(screen.getByText(/team members/i)).toBeInTheDocument();
      expect(screen.getByText("Current usage: 5 / 5")).toBeInTheDocument();
      const link = screen.getByRole("link", { name: "Compare plans" });
      expect(link).toHaveAttribute("href", "/settings/subscription");
    });

    /** @scenario The upgrade modal names the cap that was reached */
    it("names the cloud Free scenario cap with the real counts", async () => {
      renderGate(true);

      act(() => {
        useUpgradeModalStore.getState().open("scenarios", 3, 3);
      });

      expect(
        await screen.findByText("You've reached the limit of 3 scenarios on your current plan."),
      ).toBeInTheDocument();
      expect(screen.getByText("Current usage: 3 / 3")).toBeInTheDocument();
      expect(screen.getByText(/everything you already have keeps working/i)).toBeInTheDocument();
      expect(screen.queryByText(/disable a membership/i)).toBeNull();
    });

    it("links to the license page on a self-hosted deployment", async () => {
      renderGate(false);

      act(() => {
        useUpgradeModalStore.getState().open("members", 5, 5);
      });

      const link = await screen.findByRole("link", { name: "Manage license" });
      expect(link).toHaveAttribute("href", "/settings/license");
    });
  });

  describe("when a lite member reaches something their seat does not open", () => {
    const openRestriction = () =>
      act(() => {
        useUpgradeModalStore.getState().openLiteMemberRestriction({ resource: "scenarios" });
      });

    beforeEach(() => {
      renderGate(true);
      openRestriction();
    });

    /** @scenario "Restriction modal uses role-based messaging" */
    it("explains the role limit without mentioning plans, billing or upgrades", async () => {
      expect(await screen.findByText("Access required")).toBeInTheDocument();
      expect(
        screen.getAllByText(
          "Your role doesn't include this action. Ask an organization admin to give you access.",
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(/plan/i)).toBeNull();
      expect(screen.queryByText(/billing/i)).toBeNull();
      expect(screen.queryByText(/pricing/i)).toBeNull();
      expect(screen.queryByText(/upgrade/i)).toBeNull();
    });

    /** @scenario Restriction modal offers "Contact Admin" not "Upgrade your plan" */
    it("offers no way to buy a bigger plan out of it", async () => {
      expect(await screen.findByText("Access required")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /upgrade/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /manage plan/i })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Go back" }).length).toBeGreaterThan(0);
    });
  });

  describe("when a seat update waits to be confirmed and billing lends the price", () => {
    it("renders billing's lent preview with the seats the change asks for", async () => {
      renderWithDesignSystem(
        <UiHostServicesContextProvider value={billingLendsThePrice}>
          <GlobalUpgradeModal isSaaS={true} />
        </UiHostServicesContextProvider>,
      );

      openSevenSeats();

      // The lent chunk loads lazily; under a busy runner it takes longer than the default second.
      expect(await screen.findByText("Priced 7 seats", {}, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByText("Seat management is not available in this deployment.")).toBeNull();
    });
  });

  describe("when a seat update waits to be confirmed and no module lends the price", () => {
    it("says seat management is unavailable rather than rendering an empty dialog", async () => {
      renderGate(true);

      openSevenSeats();

      expect(
        await screen.findByText("Seat management is not available in this deployment."),
      ).toBeInTheDocument();
    });
  });
});
