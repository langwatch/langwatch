/**
 * @vitest-environment jsdom
 *
 * One person, as the routed `person` drawer.
 * @see specs/identity/directory-administration.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";

const state = vi.hoisted(() => ({
  member: null as unknown,
  billingHolders: [] as { userId: string }[],
  setBilling: [] as unknown[],
  provenance: {} as Record<string, unknown>,
  provenanceFails: false,
  seatRequests: undefined as unknown,
  seatAnswers: [] as { path: string; input: unknown }[],
}));

vi.mock("../../../behavior/organization-api.ts", () => {
  const invalidator = { invalidate: vi.fn() };
  return {
    api: {
      useUtils: () => ({
        organization: {
          getMemberById: invalidator,
          getOrganizationWithMembersAndTheirTeams: invalidator,
          listHeldSeats: invalidator,
          getDirectoryCounts: invalidator,
        },
        authz: { listBillingMembers: invalidator },
        limits: { getUsage: invalidator },
        licenseEnforcement: { checkLimit: invalidator },
        seatRequest: { listOpen: invalidator },
      }),
      seatRequest: {
        listOpen: { useQuery: () => ({ data: state.seatRequests }) },
        ...Object.fromEntries(
          ["approve", "approveWithSeat", "completeSeatApproval", "decline"].map((name) => [
            name,
            {
              useMutation: () => ({
                mutateAsync: async (input: unknown) => {
                  state.seatAnswers.push({ path: name, input });
                  return { outcome: "promoted" };
                },
              }),
            },
          ]),
        ),
      },
      organization: {
        getMemberById: {
          useQuery: () => ({ data: state.member, isError: false, error: null }),
        },
        getSeatRemovalPreview: {
          useQuery: () => ({ data: undefined, isSuccess: false, isError: false }),
        },
        deleteMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setMemberDisabled: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      authz: {
        listBillingMembers: {
          useQuery: () => ({ data: state.billingHolders, isLoading: false, isError: false }),
        },
        setMemberBillingRole: {
          useMutation: () => ({
            mutate: (input: unknown) => state.setBilling.push(input),
            isPending: false,
          }),
        },
      },
    },
  };
});

vi.mock("../../../behavior/use-member-provenance.ts", () => ({
  useMemberProvenance: () =>
    state.provenanceFails
      ? { data: undefined, isError: true, error: new Error("boom") }
      : { data: state.provenance, isError: false, error: null },
}));

vi.mock("../../../behavior/use-two-step-requirement.ts", () => ({
  useTwoStepRequirement: () => ({
    show: true,
    mfaRequired: true,
    byUser: new Map([
      ["user-sam", { userId: "user-sam", satisfaction: { satisfied: true }, passkeyCount: 0 }],
    ]),
  }),
}));

// The access editor is covered on its own; here it only has to be present.
vi.mock("../member-access-editor.tsx", () => ({
  MemberAccessEditor: ({ isCurrentUser }: { isCurrentUser: boolean }) => (
    <div data-testid="member-access-editor">
      {isCurrentUser ? "You cannot change your own organization role." : "role"}
    </div>
  ),
}));

const { PersonDrawer } = await import("../person-drawer.tsx");

const sam = {
  userId: "user-sam",
  role: "MEMBER",
  disabledAt: null,
  user: {
    id: "user-sam",
    name: "Sam Rivera",
    email: "sam@acme.com",
    emailVerified: true,
    image: null,
    deactivatedAt: null,
  },
};

const ANA = { id: "user-ana", name: "Ana", email: "ana@acme.com", image: null };
const SAM_AS_READER = { id: "user-sam", name: "Sam Rivera", email: "sam@acme.com", image: null };

function renderDrawer({
  userId = "user-sam",
  currentUser = ANA,
}: { userId?: string; currentUser?: typeof ANA } = {}) {
  return renderWithOrganizationHost(
    <PersonDrawer userId={userId} />,
    new FakeOrganizationHost({ currentUser }),
  );
}

describe("given a person opened from the members list", () => {
  beforeEach(() => {
    state.member = sam;
    state.provenance = { "user-sam": { source: "invited" } };
    state.provenanceFails = false;
    state.billingHolders = [];
    state.setBilling = [];
    state.seatRequests = undefined;
    state.seatAnswers = [];
  });
  afterEach(() => cleanup());

  describe("when the person has an open seat request", () => {
    const openRequest = {
      requests: [
        {
          id: "seat-request-sam",
          email: "sam@acme.com",
          name: "Sam Rivera",
          userId: "user-sam",
          source: "requested",
          idpRefused: false,
          idpKind: null,
          reason: "run the workbench",
          openedAt: 0,
        },
        {
          id: "seat-request-other",
          email: "other@acme.com",
          name: "Someone Else",
          userId: "user-other",
          source: "pending",
          idpRefused: false,
          idpKind: null,
          reason: null,
          openedAt: 0,
        },
      ],
      seatFree: true,
      approvalPath: { kind: "upgrade_plan", url: "/settings/subscription" },
    };

    /** @scenario "The member drawer shows the person's open seat request" */
    it("shows only their request with Approve and Decline", async () => {
      state.seatRequests = openRequest;
      const { host } = renderWithOrganizationHost(
        <PersonDrawer userId="user-sam" />,
        new FakeOrganizationHost({
          currentUser: ANA,
          grants: new Set([
            "organization:view",
            "organization:manage",
            "seatRequests:view",
            "seatRequests:manage",
          ]),
        }),
      );

      const section = await screen.findByTestId("person-seat-request");
      expect(section).toHaveTextContent("run the workbench");
      expect(section).not.toHaveTextContent("Someone Else");
      await userEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(state.seatAnswers).toEqual([
        { path: "approve", input: { organizationId: "org-1", seatRequestId: "seat-request-sam" } },
      ]);
      await vi.waitFor(() =>
        expect(host.successes).toEqual([
          expect.objectContaining({ title: "Sam Rivera has a full seat" }),
        ]),
      );
      expect(host.failures).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    });

    it("stays hidden from a reader who cannot see seat requests", async () => {
      state.seatRequests = openRequest;
      renderDrawer();

      await screen.findByTestId("person-address-state");
      expect(screen.queryByTestId("person-seat-request")).toBeNull();
    });
  });

  describe("when an administrator toggles Billing", () => {
    /** @scenario "Admin grants and revokes Billing" */
    it("grants it to a member without it, and shows the badge on a holder", async () => {
      renderDrawer();
      await screen.findByTestId("person-address-state");
      expect(screen.queryByTestId("person-billing-badge")).toBeNull();

      await userEvent.click(screen.getByTestId("person-billing-switch"));
      expect(state.setBilling).toEqual([
        expect.objectContaining({ userId: "user-sam", holds: true }),
      ]);

      cleanup();
      state.billingHolders = [{ userId: "user-sam" }];
      renderDrawer();
      expect(await screen.findByTestId("person-billing-badge")).toHaveTextContent("Billing");
    });

    /** @scenario "Billing cannot be taken from a Billing-only member" */
    it("shows Billing on and locked for a Billing-only member, with what to do instead", async () => {
      state.member = { ...sam, role: "EXTERNAL", billingOnly: true };
      state.billingHolders = [{ userId: "user-sam" }];
      renderDrawer();
      await screen.findByTestId("person-address-state");

      const billingSwitch = screen.getByRole("checkbox", { name: /Pays for the organization/ });
      expect(billingSwitch).toBeChecked();
      expect(billingSwitch).toBeDisabled();
      expect(screen.getByTestId("person-billing-locked")).toHaveTextContent(
        /remove them from the organization, or move them to a seat/,
      );
    });

    /** @scenario "A Billing-only member whose Billing grant is missing can be repaired" */
    it("leaves the switch live for a Billing-only member whose grant is missing, so it can be repaired", async () => {
      state.member = { ...sam, role: "EXTERNAL", billingOnly: true };
      renderDrawer();
      await screen.findByTestId("person-address-state");

      const billingSwitch = screen.getByRole("checkbox", { name: /Pays for the organization/ });
      expect(billingSwitch).not.toBeChecked();
      expect(billingSwitch).toBeEnabled();
      await userEvent.click(billingSwitch);
      expect(state.setBilling).toEqual([
        expect.objectContaining({ userId: "user-sam", holds: true }),
      ]);
    });
  });

  describe("when the drawer renders", () => {
    /** @scenario The drawer answers who, what and what next */
    it("says how they sign in, why they are here and what they can reach", async () => {
      renderDrawer();

      expect(await screen.findByTestId("person-address-state")).toBeInTheDocument();
      expect(screen.getAllByText("sam@acme.com").length).toBeGreaterThan(0);
      expect(screen.getByTestId("person-address-state")).toHaveTextContent("Verified");
      expect(screen.getByTestId("second-factor-yes")).toBeInTheDocument();
      expect(screen.getByTestId("provenance-invited")).toBeInTheDocument();
      expect(screen.getByTestId("provenance-explanation")).toHaveTextContent(
        "Somebody here invited them, and they accepted.",
      );
      expect(screen.getByText("What they can reach")).toBeInTheDocument();
      expect(screen.getByTestId("member-access-editor")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Take their seat away/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Remove from organization/ })).toBeInTheDocument();
    });

    /** @scenario Signing in as somebody is not offered here */
    it("offers nothing that signs in as them", async () => {
      renderDrawer();
      await screen.findByTestId("person-address-state");

      const text = document.body.textContent?.toLowerCase() ?? "";
      expect(text).not.toContain("impersonat");
      expect(text).not.toContain("sign in as");
    });

    /** @scenario The drawer answers who, what and what next */
    it("names an unproved address as unproved rather than leaving it blank", async () => {
      state.member = { ...sam, user: { ...sam.user, emailVerified: false } };
      renderDrawer();

      expect(await screen.findByTestId("person-address-state")).toHaveTextContent("Unverified");
    });
  });

  describe("given somebody who joined through single sign-on", () => {
    /** @scenario "The person drawer explains a single sign-on joiner" */
    it("says so rather than that nothing explains them", async () => {
      state.provenance = { "user-sam": { source: "sso", connectionId: "conn_1" } };
      renderDrawer();

      expect(await screen.findByTestId("provenance-sso")).toBeInTheDocument();
      expect(screen.getByTestId("provenance-explanation")).toHaveTextContent(/single sign-on/);
      expect(screen.queryByText(/Nothing on record/)).toBeNull();
    });
  });

  describe("given the read that explains each member fails", () => {
    /** @scenario The drawer answers who, what and what next */
    it("still opens the person and says only that the reason could not be worked out", async () => {
      state.provenanceFails = true;
      renderDrawer();

      expect(await screen.findByTestId("person-address-state")).toBeInTheDocument();
      expect(screen.getByText(/couldn.t work that out just now/i)).toBeInTheDocument();
    });
  });

  describe("when an administrator opens themselves", () => {
    /** @scenario An administrator cannot change their own organization role */
    it("offers no seat or membership action, and says why the role is fixed", async () => {
      renderDrawer({ currentUser: SAM_AS_READER });

      expect(await screen.findByTestId("member-access-editor")).toHaveTextContent(
        "cannot change your own organization role",
      );
      expect(screen.queryByRole("button", { name: /Remove from organization/ })).toBeNull();
    });
  });

  describe("when the address names nobody", () => {
    /** @scenario Opening a person puts them in the address bar */
    it("says the link names nobody rather than showing an empty person", async () => {
      renderWithOrganizationHost(<PersonDrawer />);

      expect(await screen.findByText(/This link does not name anybody/)).toBeInTheDocument();
    });
  });
});
