/**
 * @vitest-environment jsdom
 * The waiting screen a held person reads instead of onboarding.
 * Spec: modules/organization/specs/seat-requests.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";
import { HeldMembershipScreen } from "../held-membership-gate.tsx";

describe("given a person held pending over the seat limit", () => {
  afterEach(() => cleanup());

  describe("when they land with no active organization", () => {
    /** @scenario "The waiting screen names who to contact instead of onboarding" */
    it("says the organization is over its seat limit and names who to contact", async () => {
      const onCheckAgain = vi.fn();
      const host = new FakeOrganizationHost();
      renderWithOrganizationHost(
        <HeldMembershipScreen
          membership={{
            organizationId: "org_acme",
            organizationName: "ACME",
            reason: "seat_limit",
            contacts: [{ name: "Ada Admin" }, { name: "Bill Payer" }],
          }}
          onCheckAgain={onCheckAgain}
        />,
        host,
      );

      expect(screen.getByText("ACME is over its seat limit")).toBeInTheDocument();
      expect(
        screen.getByText(
          "We've asked your administrators to approve a seat. Contact one of them: Ada Admin, Bill Payer.",
        ),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Check again" }));
      expect(onCheckAgain).toHaveBeenCalledOnce();
      await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(host.signedOut).toBe(true);
    });
  });

  describe("when an administrator turned their access off", () => {
    it("says so and names who to contact", () => {
      renderWithOrganizationHost(
        <HeldMembershipScreen
          membership={{
            organizationId: "org_acme",
            organizationName: "ACME",
            reason: "access_turned_off",
            contacts: [{ name: "Ada Admin" }],
          }}
          onCheckAgain={vi.fn()}
        />,
      );

      expect(screen.getByText("Your access to ACME is turned off")).toBeInTheDocument();
      expect(
        screen.getByText(
          "An administrator turned off your access to ACME. Contact one of them: Ada Admin.",
        ),
      ).toBeInTheDocument();
    });
  });
});
