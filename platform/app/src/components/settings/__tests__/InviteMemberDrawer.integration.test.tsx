/**
 * @vitest-environment jsdom
 *
 * The invite drawer is the one place an invite is created from, whichever
 * entry point opened it. These tests drive the real drawer and the real
 * useInviteActions hook, stubbing only the tRPC boundary, so the organization
 * and team an invite is created against are observed on the mutation itself.
 *
 * @see specs/settings/add-member-drawer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteMemberDrawer } from "../InviteMemberDrawer";

const { mockCloseDrawer, mockCreateInvites } = vi.hoisted(() => ({
  mockCloseDrawer: vi.fn(),
  mockCreateInvites: vi.fn(),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    pathname: "/settings/members",
    push: vi.fn(),
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: {
      id: "org_acme",
      teams: [
        { id: "team_platform", name: "Platform" },
        { id: "team_growth", name: "Growth" },
      ],
    },
    team: null,
    project: null,
    hasPermission: () => true,
  }),
}));

vi.mock("../../../hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

// Limits unknown -> the hook proceeds optimistically and the server stays the
// final guard, which is the path an unconstrained org takes.
vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    limitInfo: undefined,
    checkAndProceed: (proceed: () => void) => proceed(),
  }),
}));

vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: (state: unknown) => unknown) =>
    selector({ openSeats: vi.fn() }),
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../../utils/api", () => {
  const noopMutation = () => ({ mutate: vi.fn(), isLoading: false });
  return {
    api: {
      useContext: () => ({
        organization: {
          getOrganizationPendingInvites: { invalidate: vi.fn() },
        },
        licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
      }),
      plan: {
        getActivePlan: {
          useQuery: () => ({
            data: { free: false, type: "GROWTH", planSource: "subscription" },
          }),
        },
      },
      role: {
        getAll: { useQuery: () => ({ data: [], isLoading: false }) },
      },
      organization: {
        createInvites: {
          useMutation: () => ({ mutate: mockCreateInvites, isLoading: false }),
        },
        createInviteRequest: { useMutation: noopMutation },
        approveInvite: { useMutation: noopMutation },
        deleteInvite: { useMutation: noopMutation },
      },
    },
  };
});

const renderDrawer = (initialEmail?: string) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <InviteMemberDrawer open={true} initialEmail={initialEmail} />
    </ChakraProvider>,
  );

/** The single email input the form renders. */
const emailField = () =>
  screen.getByLabelText("Email addresses") as HTMLInputElement;

describe("<InviteMemberDrawer/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the drawer was opened carrying an email typed elsewhere", () => {
    describe("when it renders", () => {
      /** @scenario The drawer opens pre-filled with an email typed elsewhere */
      it("pre-fills the email field with what was typed", () => {
        renderDrawer("someone@example.com");

        expect(emailField().value).toBe("someone@example.com");
      });
    });
  });

  describe("given the drawer was opened with nothing typed", () => {
    describe("when it renders", () => {
      /** @scenario The drawer opens pre-filled with an email typed elsewhere */
      it("leaves the email field empty rather than inventing a value", () => {
        renderDrawer();

        expect(emailField().value).toBe("");
      });
    });
  });

  describe("given an admin fills in the drawer for an organization", () => {
    describe("when they submit an email with a team assignment", () => {
      /** @scenario Inviting through the drawer preserves organization and team scope */
      it("creates the invite against that organization and team", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.type(emailField(), "newhire@example.com");
        await user.click(screen.getByRole("button", { name: /send invites/i }));

        await waitFor(() => expect(mockCreateInvites).toHaveBeenCalled());

        const [payload] = mockCreateInvites.mock.calls[0] as [
          {
            organizationId: string;
            invites: {
              email: string;
              teams: { teamId: string }[];
            }[];
          },
        ];
        expect(payload.organizationId).toBe("org_acme");
        expect(payload.invites).toHaveLength(1);
        expect(payload.invites[0]?.email).toBe("newhire@example.com");
        expect(payload.invites[0]?.teams.map((team) => team.teamId)).toEqual([
          "team_platform",
        ]);
      });

      /** @scenario Inviting through the drawer preserves organization and team scope */
      it("closes the drawer once the invite is created", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.type(emailField(), "newhire@example.com");
        await user.click(screen.getByRole("button", { name: /send invites/i }));

        await waitFor(() => expect(mockCreateInvites).toHaveBeenCalled());
        expect(mockCloseDrawer).not.toHaveBeenCalled();

        // The server answers: one invite created.
        const [, handlers] = mockCreateInvites.mock.calls[0] as [
          unknown,
          { onSuccess: (data: unknown) => void },
        ];
        handlers.onSuccess([
          {
            invite: { inviteCode: "inv_1", email: "newhire@example.com" },
            emailNotSent: false,
          },
        ]);

        expect(mockCloseDrawer).toHaveBeenCalled();
      });
    });
  });
});
