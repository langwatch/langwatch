/**
 * @vitest-environment jsdom
 *
 * One person, as the routed `person` drawer.
 * @see specs/identity/directory-administration.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";

const state = vi.hoisted(() => ({
  member: null as unknown,
  provenance: {} as Record<string, unknown>,
  provenanceFails: false,
}));

vi.mock("../../../behavior/organization-api.ts", () => {
  const invalidator = { invalidate: vi.fn() };
  return {
    api: {
      useUtils: () => ({
        organization: {
          getMemberById: invalidator,
          getOrganizationWithMembersAndTheirTeams: invalidator,
        },
        limits: { getUsage: invalidator },
        licenseEnforcement: { checkLimit: invalidator },
      }),
      organization: {
        getMemberById: {
          useQuery: () => ({ data: state.member, isError: false, error: null }),
        },
        getMemberProvenance: {
          useQuery: () =>
            state.provenanceFails
              ? { data: undefined, isError: true, error: new Error("boom") }
              : { data: state.provenance, isError: false, error: null },
        },
        deleteMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setMemberDisabled: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});

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
  });
  afterEach(() => cleanup());

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
