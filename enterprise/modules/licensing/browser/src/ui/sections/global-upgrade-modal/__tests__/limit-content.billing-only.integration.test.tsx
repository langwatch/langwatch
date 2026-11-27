/**
 * @vitest-environment jsdom
 * @see specs/licensing/billing-only-invite.feature
 * At a cloud seat limit an admin is offered a way to let someone else pay; anyone else is
 * still pointed to an admin.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { useUpgradeModalStore } from "../../../../model/upgrade-modal-store.ts";
import { GlobalUpgradeModal } from "../global-upgrade-modal.tsx";

let currentSearch = "";

function LocationProbe() {
  currentSearch = useLocation().search;
  return null;
}

function renderModal({ isAdmin }: { isAdmin: boolean }) {
  return renderWithDesignSystem(
    <MemoryRouter initialEntries={["/settings/members"]}>
      <GlobalUpgradeModal isSaaS isAdmin={isAdmin} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const reachSeatLimit = () =>
  act(() => {
    useUpgradeModalStore.getState().open("members", 2, 2);
  });

describe("the seat limit message", () => {
  afterEach(() => {
    act(() => {
      useUpgradeModalStore.getState().close();
    });
    cleanup();
    currentSearch = "";
  });

  describe("given an admin who reaches a seat limit", () => {
    /** @scenario "The limit message offers an admin a way to let someone pay" */
    it("offers Upgrade and Invite someone to pay, without asking for an admin", async () => {
      renderModal({ isAdmin: true });
      reachSeatLimit();

      expect(await screen.findByRole("link", { name: "Upgrade" })).toHaveAttribute(
        "href",
        "/settings/subscription",
      );
      expect(screen.getByTestId("limit-invite-billing-only")).toHaveTextContent(
        "Invite someone to pay",
      );
      expect(screen.queryByText(/ask an organization admin/i)).not.toBeInTheDocument();
    });

    /** @scenario "The limit message offers an admin a way to let someone pay" */
    it("opens the invite drawer on Billing only", async () => {
      renderModal({ isAdmin: true });
      reachSeatLimit();

      fireEvent.click(await screen.findByTestId("limit-invite-billing-only"));

      expect(decodeURIComponent(currentSearch)).toContain("BILLING_ONLY");
    });
  });

  describe("given a member who is not an admin reaches a seat limit", () => {
    /** @scenario "A non-admin at a limit is still pointed to an admin" */
    it("tells them to ask an organization admin and offers no invite", async () => {
      renderModal({ isAdmin: false });
      reachSeatLimit();

      expect(await screen.findByText(/ask an organization admin/i)).toBeInTheDocument();
      expect(screen.queryByTestId("limit-invite-billing-only")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Compare plans" })).toBeInTheDocument();
    });
  });

  describe("given an admin who reaches a limit that is not a seat", () => {
    it("keeps the plan comparison and offers no invite", async () => {
      renderModal({ isAdmin: true });
      act(() => {
        useUpgradeModalStore.getState().open("scenarios", 3, 3);
      });

      expect(await screen.findByRole("link", { name: "Compare plans" })).toBeInTheDocument();
      expect(screen.queryByTestId("limit-invite-billing-only")).not.toBeInTheDocument();
    });
  });
});
