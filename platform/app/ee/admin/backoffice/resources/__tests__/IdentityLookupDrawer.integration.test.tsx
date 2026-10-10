/**
 * @vitest-environment jsdom
 *
 * The person drawer: methods in every state, everything waiting on one
 * panel, and the confirmations that name what a repair lands on.
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityLookupDrawer } from "../IdentityLookupDrawer";

const personState = vi.hoisted(() => ({
  current: { data: undefined as unknown, error: null as Error | null },
}));

vi.mock("~/utils/api", () => {
  const mutation = () => ({ useMutation: () => ({ mutate: vi.fn() }) });
  return {
    api: {
      useContext: () => ({ identityLookup: { invalidate: vi.fn() } }),
      identityLookup: {
        person: { useQuery: () => personState.current },
        confirmProposedSignIn: mutation(),
        rejectProposedSignIn: mutation(),
        detachMethod: mutation(),
        endSessions: mutation(),
        resendInvitation: mutation(),
        extendInvitation: mutation(),
      },
    },
  };
});

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));
vi.mock("~/features/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/errors")>()),
  showErrorToast: vi.fn(),
}));

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function detail(overrides: Record<string, unknown> = {}) {
  return {
    person: {
      userId: "user_sam",
      name: "Sam Carter",
      email: "sam@acme.com",
      organizations: [
        { organizationId: "org_acme", name: "Acme", role: "MEMBER" },
      ],
      holding: [],
    },
    identifiers: [
      {
        identifierId: "idf_work",
        provider: "email",
        value: "sam@acme.com",
        domain: "acme.com",
        state: "VERIFIED",
        connectionId: null,
        verifiedAtMs: NOW - DAY,
        attachedAtMs: NOW - 2 * DAY,
        detachedAtMs: null,
      },
      {
        identifierId: "idf_old",
        provider: "google",
        value: "sam@example.com",
        domain: "example.com",
        state: "DETACHED",
        connectionId: null,
        verifiedAtMs: null,
        attachedAtMs: NOW - 30 * DAY,
        detachedAtMs: NOW - 10 * DAY,
      },
    ],
    waiting: {
      proposals: [
        {
          proposalId: "prop_1",
          userId: "user_sam",
          connectionId: "ssoc_acme",
          provider: "oidc",
          providerAccountId: "sub-1",
          value: "sam@acme.com",
          domain: "acme.com",
          reason: "unverified_orphan",
          proposedAtMs: NOW - 2 * 60 * 60 * 1000,
          decision: null,
        },
      ],
      invitations: [
        {
          inviteId: "inv_1",
          email: "sam@acme.com",
          organizationId: "org_acme",
          organizationName: "Acme",
          invitedByName: "Ada Lovelace",
          status: "PENDING",
          expiresAtMs: NOW - DAY,
          isExpired: true,
        },
      ],
      domainClaims: [
        {
          connectionId: "ssoc_acme",
          organizationId: "org_acme",
          organizationName: "Acme",
          domain: "acme.com",
          waitingSinceMs: NOW - 3 * DAY,
        },
      ],
      isEmpty: false,
    },
    history: [
      {
        eventId: "evt_2",
        type: "lw.identity.identifier_detached",
        occurredAtMs: NOW - DAY,
        actor: { type: "user", id: "user_olive" },
        identifierId: "idf_old",
        provider: null,
        value: null,
        domain: null,
        connectionId: null,
        proposalId: null,
        detail: null,
      },
      {
        eventId: "evt_1",
        type: "lw.identity.identifier_attached",
        occurredAtMs: NOW - 30 * DAY,
        actor: { type: "system", id: null },
        identifierId: "idf_old",
        provider: "google",
        value: "sam@example.com",
        domain: "example.com",
        connectionId: null,
        proposalId: null,
        detail: "ATTACHED",
      },
    ],
    sessions: [
      {
        sessionId: "ses_1",
        identifierId: "idf_work",
        createdAtMs: NOW - 60_000,
        expiresAtMs: NOW + DAY,
      },
    ],
    ...overrides,
  };
}

function renderDrawer({ canRepair = true }: { canRepair?: boolean } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IdentityLookupDrawer
        userId="user_sam"
        address="sam@acme.com"
        canRepair={canRepair}
        onClose={vi.fn()}
      />
    </ChakraProvider>,
  );
}

describe("given an operator who has opened a person from the lookup", () => {
  beforeEach(() => {
    personState.current = { data: detail(), error: null };
  });

  describe("when the drawer is rendered", () => {
    /** @scenario "Each person's sign-in methods are listed whatever state they are in" */
    it("lists every method in every state, with what proved it and when it stopped counting", () => {
      renderDrawer();

      // The proved one, and the one that no longer signs anybody in.
      expect(
        screen.getByText("sam@acme.com · proved", { exact: false }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("sam@example.com · removed", { exact: false }),
      ).toBeInTheDocument();

      // Each says when it was attached, what proved it, and — where it
      // applies — when it stopped counting.
      expect(
        screen.getByText(/proved by email on/, { exact: false }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/nothing has proved it/, { exact: false }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/stopped counting/, { exact: false }),
      ).toBeInTheDocument();
    });

    /** @scenario "Everything waiting on a human is on one panel" */
    it("puts waiting sign-ins, invitations and domain claims on one panel", () => {
      renderDrawer();

      expect(screen.getByText("Waiting")).toBeInTheDocument();
      expect(
        screen.getByText(/Sign-in through oidc/, { exact: false }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Invitation to Acme, sent by Ada Lovelace/),
      ).toBeInTheDocument();
      // Past its expiry says so rather than looking live.
      expect(screen.getByText(/^Expired /)).toBeInTheDocument();
      expect(screen.getByText(/Domain claim on acme.com/)).toBeInTheDocument();
    });

    /** @scenario "The most recent identity history is shown newest first" */
    it("renders the history newest first with who caused each fact", () => {
      renderDrawer();

      const entries = screen
        .getByTestId("identity-history")
        .textContent?.replace(/\s+/g, " ");
      expect(entries).toContain("Sign-in method removed");
      expect(entries).toContain("by user_olive");
      expect(entries?.indexOf("Sign-in method removed")).toBeLessThan(
        entries?.indexOf("Sign-in method attached") ?? 0,
      );
    });

    /** @scenario "Every repair names the organization it lands on before it runs" */
    it("names the organization and the person before a repair runs", async () => {
      renderDrawer();

      fireEvent.click(screen.getAllByText("Remove")[0]!);

      await waitFor(() => {
        expect(
          screen.getByText("Remove a sign-in method for Sam Carter at Acme?"),
        ).toBeInTheDocument();
      });
      // And it says what will change, in words rather than a value.
      expect(
        screen.getByText(/will no longer be able to sign in with this method/),
      ).toBeInTheDocument();
    });
  });

  describe("when nothing at all is waiting", () => {
    /** @scenario "Everything waiting on a human is on one panel" */
    it("collapses the panel to a single line", () => {
      personState.current = {
        data: detail({
          waiting: {
            proposals: [],
            invitations: [],
            domainClaims: [],
            isEmpty: true,
          },
        }),
        error: null,
      };
      renderDrawer();

      expect(screen.getByTestId("waiting-empty")).toHaveTextContent(
        "Nothing is waiting on a human.",
      );
      expect(screen.queryByText("Waiting")).not.toBeInTheDocument();
    });
  });

  describe("when the organization behind the person cannot be named", () => {
    /** @scenario "A repair whose target cannot be named is withheld rather than confirmed" */
    it("withholds the repairs and says why", () => {
      const unnameable = detail();
      unnameable.person.organizations = [];
      personState.current = { data: unnameable, error: null };
      renderDrawer();

      expect(screen.queryByText("Remove")).not.toBeInTheDocument();
      expect(
        screen.getAllByText(/Repairs are unavailable/)[0],
      ).toBeInTheDocument();
    });
  });

  describe("when she may look but may not repair", () => {
    /** @scenario "An operator who may look but not repair is shown nothing they cannot use" */
    it("renders every panel and no repair", () => {
      renderDrawer({ canRepair: false });

      // Everything readable is readable.
      expect(screen.getByText("Sign-in methods")).toBeInTheDocument();
      expect(screen.getByText("Waiting")).toBeInTheDocument();
      expect(screen.getByText("History")).toBeInTheDocument();

      // And no repair exists to be pressed.
      expect(screen.queryByText("Remove")).not.toBeInTheDocument();
      expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
      expect(screen.queryByText("Reject")).not.toBeInTheDocument();
      expect(screen.queryByText("Resend")).not.toBeInTheDocument();
      expect(screen.queryByText("Extend")).not.toBeInTheDocument();
      expect(screen.queryByText("End its sessions")).not.toBeInTheDocument();
    });
  });
});
