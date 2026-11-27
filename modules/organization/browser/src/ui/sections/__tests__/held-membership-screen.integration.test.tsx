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
import HeldMembershipGate, { HeldMembershipScreen } from "../held-membership-gate.tsx";

const { heldRead } = vi.hoisted(() => ({
  heldRead: { current: {} as Record<string, unknown> },
}));

vi.mock("../../../behavior/organization-api.ts", () => ({
  api: {
    seatRequest: {
      myHeldMemberships: { useQuery: () => ({ refetch: vi.fn(), ...heldRead.current }) },
    },
  },
}));

const HELD = {
  organizationId: "org_acme",
  organizationName: "ACME",
  reason: "seat_limit" as const,
  contacts: [{ name: "Ada Admin", email: "ada@acme.example" }],
};

describe("given onboarding's welcome behind the held-membership gate", () => {
  afterEach(() => cleanup());

  describe("when the person holds only a held membership", () => {
    /** @scenario "The waiting screen names who to contact instead of onboarding" */
    it("shows the waiting screen instead of onboarding", () => {
      heldRead.current = {
        isPending: false,
        isError: false,
        data: { hasActiveMembership: false, held: [HELD] },
      };
      renderWithOrganizationHost(
        <HeldMembershipGate>
          <p>Create your organization</p>
        </HeldMembershipGate>,
      );

      expect(screen.getByText("ACME is over its seat limit")).toBeInTheDocument();
      expect(screen.queryByText("Create your organization")).not.toBeInTheDocument();
    });
  });

  describe("when the person also has an active membership, or the read failed", () => {
    it.each([
      ["an active membership", { data: { hasActiveMembership: true, held: [HELD] } }],
      ["a failed read", { isError: true, data: undefined }],
      ["no held membership", { data: { hasActiveMembership: false, held: [] } }],
    ])("shows onboarding for %s", (_case, read) => {
      heldRead.current = { isPending: false, isError: false, ...read };
      renderWithOrganizationHost(
        <HeldMembershipGate>
          <p>Create your organization</p>
        </HeldMembershipGate>,
      );

      expect(screen.getByText("Create your organization")).toBeInTheDocument();
      expect(screen.queryByText("ACME is over its seat limit")).not.toBeInTheDocument();
    });
  });
});

describe("given a person held pending over the seat limit", () => {
  afterEach(() => cleanup());

  describe("when they land with no active organization", () => {
    /** @scenario "The waiting screen names who to contact instead of onboarding" */
    it("says the organization is over its seat limits and lists each contact with their email", async () => {
      const onCheckAgain = vi.fn();
      const host = new FakeOrganizationHost();
      renderWithOrganizationHost(
        <HeldMembershipScreen
          membership={{
            organizationId: "org_acme",
            organizationName: "ACME",
            reason: "seat_limit",
            contacts: [
              { name: "Ada Admin", email: "ada@acme.example" },
              { name: "Bill Payer", email: "bill@acme.example" },
            ],
          }}
          onCheckAgain={onCheckAgain}
        />,
        host,
      );

      expect(screen.getByText("ACME is over its seat limit")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Your organization is over its seat limits. Please contact an administrator to approve your access:",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Ada Admin (ada@acme.example)")).toBeInTheDocument();
      expect(screen.getByText("Bill Payer (bill@acme.example)")).toBeInTheDocument();
      expect(screen.queryByText(/We will email you/)).not.toBeInTheDocument();

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
            contacts: [{ name: "Ada Admin", email: null }],
          }}
          onCheckAgain={vi.fn()}
        />,
      );

      expect(screen.getByText("Your access to ACME is turned off")).toBeInTheDocument();
      expect(
        screen.getByText("An administrator turned off your access to ACME. Contact one of them:"),
      ).toBeInTheDocument();
      expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    });
  });
});
