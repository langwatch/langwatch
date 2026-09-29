/**
 * @vitest-environment jsdom
 *
 * One person, as a URL-routed drawer (D05).
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionUserId: "user_ana",
  member: null as unknown,
  provenance: {} as Record<string, unknown>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme", teams: [] },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: state.sessionUserId } } }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("~/hooks/useMemberDisableAction", () => ({
  useMemberDisableAction: () => ({
    setMemberDisabled: vi.fn(),
    isSettingDisabled: false,
  }),
}));

vi.mock("~/components/members/useTwoStepRequirement", () => ({
  useTwoStepRequirement: () => ({
    show: true,
    mfaRequired: true,
    byUser: new Map([
      [
        "user_sam",
        {
          userId: "user_sam",
          satisfaction: { satisfied: true },
          passkeyCount: 0,
        },
      ],
    ]),
    members: [],
    heldCount: 0,
    connection: { connected: false, assertsSecondFactor: false },
    saving: false,
    setRequirement: vi.fn(),
  }),
}));

// The access editor is covered on its own; here it only has to be present.
vi.mock("../MemberAccessEditor", () => ({
  MemberAccessEditor: ({ isCurrentUser }: { isCurrentUser: boolean }) => (
    <div data-testid="member-access-editor">
      {isCurrentUser ? "You cannot change your own organization role." : "role"}
    </div>
  ),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      organization: {
        getMemberById: { invalidate: vi.fn() },
        getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() },
      },
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    organization: {
      getMemberById: {
        useQuery: () => ({
          data: state.member,
          isError: false,
          error: null,
        }),
      },
      getMemberProvenance: {
        useQuery: () => ({
          data: state.provenance,
          isError: false,
          error: null,
        }),
      },
      deleteMember: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

const { PersonDrawer } = await import("../PersonDrawer");

function renderDrawer(userId = "user_sam") {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <PersonDrawer userId={userId} />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

const sam = {
  userId: "user_sam",
  role: "MEMBER",
  disabledAt: null,
  user: {
    id: "user_sam",
    name: "Sam Rivera",
    email: "sam@acme.com",
    emailVerified: new Date("2026-01-01T00:00:00Z"),
    image: null,
    deactivatedAt: null,
  },
};

describe("given a person opened from the members list", () => {
  beforeEach(() => {
    state.sessionUserId = "user_ana";
    state.member = sam;
    state.provenance = {
      user_sam: { source: "invited" },
    };
  });
  afterEach(() => cleanup());

  describe("when the drawer renders", () => {
    /** @scenario The drawer answers who, what and what next */
    it("says how they sign in, why they are here and what they can reach", () => {
      renderDrawer();

      // Twice on purpose: once on the row that identifies them, once as the
      // address fact with its proved state beside it.
      expect(screen.getAllByText("sam@acme.com").length).toBeGreaterThan(0);
      expect(screen.getByTestId("person-address-state").textContent).toBe(
        "Verified",
      );
      expect(screen.getByTestId("second-factor-yes")).toBeInTheDocument();
      expect(screen.getByTestId("provenance-invited")).toBeInTheDocument();
      expect(screen.getByTestId("member-access-editor")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Take their seat away/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Remove from organization/ }),
      ).toBeInTheDocument();
    });

    /** @scenario Signing in as somebody is not offered here */
    it("offers nothing that signs in as them", () => {
      const { container } = renderDrawer();

      expect(container.textContent?.toLowerCase()).not.toContain("impersonat");
      expect(container.textContent?.toLowerCase()).not.toContain("sign in as");
    });

    /** @scenario The drawer answers who, what and what next */
    it("names an unproved address as unproved rather than leaving it blank", () => {
      state.member = {
        ...sam,
        user: { ...sam.user, emailVerified: null },
      };
      renderDrawer();

      expect(screen.getByTestId("person-address-state").textContent).toBe(
        "Unverified",
      );
    });
  });

  describe("when an administrator opens themselves", () => {
    /** @scenario An administrator cannot change their own organization role */
    it("offers no seat or membership action, and says why the role is fixed", () => {
      state.sessionUserId = "user_sam";
      renderDrawer();

      expect(screen.getByTestId("member-access-editor").textContent).toContain(
        "cannot change your own organization role",
      );
      expect(
        screen.queryByRole("button", { name: /Remove from organization/ }),
      ).toBeNull();
    });
  });

  describe("when the address names nobody", () => {
    /** @scenario Opening a person puts them in the address bar */
    it("says the link names nobody rather than showing an empty person", () => {
      render(
        <MemoryRouter>
          <ChakraProvider value={defaultSystem}>
            <PersonDrawer />
          </ChakraProvider>
        </MemoryRouter>,
      );

      expect(
        screen.getByText(/This link does not name anybody/),
      ).toBeInTheDocument();
    });
  });
});
