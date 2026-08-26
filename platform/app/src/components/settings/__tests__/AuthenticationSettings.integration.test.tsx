/**
 * @vitest-environment jsdom
 *
 * The organization's Authentication page, in both of its modes (ADR-124,
 * wave 3 — see specs/identity/org-access-cluster.feature).
 *
 * A live connection is READ: what protocol it speaks, where it stands in
 * words, which domains it actually routes and what condition their evidence
 * is in, beside the directory that provisions the people who use it. Anything
 * short of live is the setup journey, unchanged, because there is nothing yet
 * to overview.
 *
 * The settings chrome is not in the tree here. What is under test is the
 * page's own two modes and what each card says, and the layout would drag the
 * whole navigation in to prove neither.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseOrganizationTeamProject,
  mockGetSetup,
  mockReconciliation,
  mockGroups,
  mockProvenance,
  mockSignInSso,
} = vi.hoisted(() => ({
  mockUseOrganizationTeamProject: vi.fn(),
  mockGetSetup: vi.fn(),
  mockReconciliation: vi.fn(),
  mockGroups: vi.fn(),
  mockProvenance: vi.fn(),
  mockSignInSso: vi.fn(),
}));

const mutationDouble = () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
});

const apiDouble = {
  api: {
    ssoSetup: {
      getSetup: { useQuery: mockGetSetup },
      register: mutationDouble(),
      claimDomain: mutationDouble(),
      removeDomain: mutationDouble(),
      proveDomain: mutationDouble(),
      checkDomainRecord: mutationDouble(),
      activate: mutationDouble(),
      grantBreakGlass: mutationDouble(),
      renewBreakGlass: mutationDouble(),
      revokeBreakGlass: mutationDouble(),
      checkDomainFile: mutationDouble(),
      setArrivals: mutationDouble(),
      discardConnection: mutationDouble(),
      removeConnection: mutationDouble(),
      breakGlassBindings: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      breakGlassCandidates: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
    },
    scimReconciliation: { getAll: { useQuery: mockReconciliation } },
    group: { listAll: { useQuery: mockGroups } },
    organization: { getMemberProvenance: { useQuery: mockProvenance } },
    // The policy card reads the plan and the deployment kind to decide
    // whether opening a door is locked. Enterprise and hosted here, so the
    // card draws its controls rather than its lock — the lock is covered in
    // the tests that own it.
    limits: {
      getUsage: {
        useQuery: () => ({
          data: { activePlan: { type: "ENTERPRISE", free: false } },
          isLoading: false,
        }),
      },
    },
    publicEnv: { useQuery: () => ({ data: { IS_SAAS: true } }) },
    useUtils: () => ({
      ssoSetup: {
        getSetup: { invalidate: vi.fn() },
        breakGlassBindings: { invalidate: vi.fn() },
      },
    }),
  },
};

const hookDouble = {
  useOrganizationTeamProject: mockUseOrganizationTeamProject,
};

vi.mock("~/hooks/useOrganizationTeamProject", () => hookDouble);
vi.mock("~/utils/api", () => apiDouble);
vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { sso: mockSignInSso } },
}));

// The two rules that arrived from the page called Access. Each is covered
// where it lives — the joining policy reads the plan, the public environment
// and the join ledger before it can draw a single radio — so here they are
// only required to be present, and in the right place.
vi.mock("~/components/members/useJoinRequests", () => ({
  useJoinRequests: () => ({
    requests: [],
    answeringId: null,
    approve: vi.fn(),
    reject: vi.fn(),
    automaticJoins: [],
    joining: { domainJoin: "off", joinDomains: [] },
    savingJoining: false,
    setJoining: vi.fn(),
  }),
}));

vi.mock("~/components/members/useTwoStepRequirement", () => ({
  useTwoStepRequirement: () => ({
    show: false,
    mfaRequired: false,
    byUser: new Map(),
    members: [],
    heldCount: 0,
    connection: { connected: false, assertsSecondFactor: false },
    saving: false,
    setRequirement: vi.fn(),
  }),
}));

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/ssoc_acme",
  assertionConsumerServiceUrl:
    "https://app.test/api/auth/sso/saml2/sp/acs/ssoc_acme",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/ssoc_acme",
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl:
    "https://app.test/api/auth/sso/saml2/sp/metadata?providerId=ssoc_acme",
};

const GO_LIVE = {
  domainProved: true,
  testSignIn: { done: true, atMs: 1_700_000_000_000 },
  breakGlass: { inPlace: true, liveCount: 1 },
  arrivalsDecided: true,
  ready: true,
  activated: true,
  routingSwitchedOn: true,
};

/** A connection that is on and carrying sign-ins, unless told otherwise. */
function liveSetup(overrides: Record<string, unknown> = {}) {
  return {
    availability: {
      available: true,
      proof: "dns-txt",
      claimWaitsForReview: true,
    },
    serviceProvider: SERVICE_PROVIDER,
    connection: {
      connectionId: "ssoc_acme",
      state: "ACTIVE",
      type: "oidc",
      providerId: "okta",
      issuer: "https://login.acme.okta.com",
      arrivalPolicy: "admit" as const,
      verifiedDomains: ["acme.com"],
      domainProofs: [
        { domain: "acme.com", proofState: "VERIFIED", graceEndsAtMs: null },
      ],
    },
    claims: [
      {
        domain: "acme.com",
        state: "APPROVED",
        claimedAtMs: 1,
        decidedAtMs: 2,
        waitedMs: 1,
        note: null,
        waitsForReview: false,
      },
    ],
    record: null,
    goLive: GO_LIVE,
    attestationOffered: false,
    ...overrides,
  };
}

function readerHolding(permissions: string[]): void {
  const holds = (permission: string) => permissions.includes(permission);
  mockUseOrganizationTeamProject.mockReturnValue({
    isLoading: false,
    organization: { id: "org_acme", name: "Acme" },
    hasPermission: holds,
    hasAnyPermission: holds,
    hasOrganizationPermission: holds,
    hasTeamPermission: holds,
  });
}

const draw = (node: ReactNode) =>
  render(
    <MemoryRouter initialEntries={["/settings/authentication"]}>
      <ChakraProvider value={defaultSystem}>{node}</ChakraProvider>
    </MemoryRouter>,
  );

const open = async () => {
  const { AuthenticationSettings } = await import("../AuthenticationSettings");
  return draw(<AuthenticationSettings organizationId="org_acme" />);
};

beforeEach(() => {
  vi.clearAllMocks();
  readerHolding(["sso:view", "sso:manage", "organization:manage"]);
  mockGetSetup.mockReturnValue({ data: liveSetup(), isLoading: false });
  mockReconciliation.mockReturnValue({
    data: {
      connections: [
        {
          connectionId: "ssoc_acme",
          providerId: "okta",
          verifiedDomains: ["acme.com"],
          state: "SYNCING",
          status: { headline: "Syncing", tone: "working" },
          lastPushedAtMs: 1_700_000_000_000,
          managedPeople: 3,
          failures: [],
          remediation: "",
        },
      ],
      recentChanges: [],
    },
    isLoading: false,
    isError: false,
  });
  mockGroups.mockReturnValue({
    data: [
      { id: "grp_1", name: "Engineering", scimSource: "okta" },
      { id: "grp_2", name: "Hand made", scimSource: null },
    ],
    isLoading: false,
    isError: false,
  });
  mockProvenance.mockReturnValue({
    data: {
      u1: { source: "directory", providerId: "okta" },
      u2: { source: "directory", providerId: "okta" },
      u3: { source: "directory", providerId: "okta" },
      u4: { source: "invited" },
    },
    isLoading: false,
    isError: false,
  });
});

describe("the organization's authentication page", () => {
  describe("given the three ways somebody gets in", () => {
    /** @scenario Who may join is asked beside the connection whose domains it reads */
    it("asks who may join on the same page as the connection", async () => {
      await open();

      expect(screen.getByTestId("join-policy-card")).toBeInTheDocument();
      expect(
        screen.getByText("Who can join your organization"),
      ).toBeInTheDocument();
    });

    /** @scenario The second-factor requirement is asked with the sign-in it guards */
    it("asks what everybody must prove where the deployment offers it", async () => {
      // The requirement's own card decides whether it applies at all; where it
      // does not, the heading over it must not appear either — a heading over
      // an absence is worse than silence.
      await open();

      expect(screen.queryByText("What everybody has to prove")).toBeNull();
    });
  });

  describe("given a live connection", () => {
    /** @scenario A connection that is on but carrying nobody says both */
    it("says whether anybody is actually being sent through it", async () => {
      await open();

      const card = screen.getByTestId("single-sign-on-card");
      expect(within(card).getByTestId("sso-routing-chip")).toHaveTextContent(
        "Everybody",
      );
    });

    /** @scenario The overview names the connection by the protocol it speaks */
    it("keeps to three short rows, so the pair of cards stays scannable", async () => {
      await open();

      const card = screen.getByTestId("single-sign-on-card");
      expect(within(card).getByText("Identity provider")).toBeInTheDocument();
      expect(within(card).getByText("Sign-in")).toBeInTheDocument();
      expect(within(card).getByText("Verified domains")).toBeInTheDocument();
      // The issuer is a monospace URL nobody compares from here, and the last
      // test and the ways back in are preconditions the journey already lists.
      expect(within(card).queryByText(/^Issuer/i)).toBeNull();
      expect(within(card).queryByText(/last tested/i)).toBeNull();
    });

    /** @scenario "The overview names the connection by the protocol it speaks" */
    it("titles the sign-on card for the protocol and names the provider", async () => {
      await open();

      const card = screen.getByTestId("single-sign-on-card");
      expect(within(card).getByText(/OpenID Connect/)).toBeTruthy();
      expect(within(card).getByText("okta")).toBeTruthy();
      expect(within(card).getByText("Active")).toBeTruthy();
      // The aggregate's own vocabulary never reaches the reader.
      expect(screen.queryByText("ACTIVE")).toBeNull();
      expect(screen.queryByText(/VERIFICATION_PENDING/)).toBeNull();
    });

    /** @scenario "A connection that is on but carrying nobody says both" */
    it("separates a connection that is on from one that is routing", async () => {
      mockGetSetup.mockReturnValue({
        data: liveSetup({ goLive: { ...GO_LIVE, routingSwitchedOn: false } }),
        isLoading: false,
      });
      await open();

      const card = screen.getByTestId("single-sign-on-card");
      expect(within(card).getByText(/not routing yet/i)).toBeTruthy();
      expect(within(card).queryByText("Active")).toBeNull();
    });

    /** @scenario "A domain whose record has gone says so on the overview" */
    it("shows a lapsed domain as missing its record rather than as proved", async () => {
      mockGetSetup.mockReturnValue({
        data: liveSetup({
          connection: {
            ...liveSetup().connection,
            domainProofs: [
              { domain: "acme.com", proofState: "LAPSED", graceEndsAtMs: null },
            ],
          },
        }),
        isLoading: false,
      });
      await open();

      const chip = screen.getByTestId("authentication-domain-chip");
      expect(chip.textContent).toContain("acme.com");
      expect(chip.textContent).toContain("Record missing");
      expect(chip.textContent).not.toContain("Proved");
    });

    /** @scenario "The overview offers only what the connection really has" */
    it("offers the test sign-in, and no metadata or certificate it does not have", async () => {
      const user = userEvent.setup();
      mockSignInSso.mockResolvedValue({ error: null });
      await open();

      await user.click(screen.getByRole("button", { name: /test sign-in/i }));
      expect(mockSignInSso).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: "ssoc_acme" }),
      );

      // Metadata is published for SAML only, and no expiry is read out of a
      // signing certificate anywhere, so neither is offered here.
      expect(screen.queryByText(/service provider metadata/i)).toBeNull();
      expect(screen.queryByText(/certificate/i)).toBeNull();
      expect(screen.queryByText(/expires/i)).toBeNull();
    });

    /** @scenario "The overview offers only what the connection really has" */
    it("offers the published metadata when the connection speaks SAML", async () => {
      mockGetSetup.mockReturnValue({
        data: liveSetup({
          connection: { ...liveSetup().connection, type: "saml" },
        }),
        isLoading: false,
      });
      await open();

      const card = screen.getByTestId("single-sign-on-card");
      expect(within(card).getByText(/SAML/)).toBeTruthy();
      expect(
        within(card)
          .getByText(/service provider metadata/i)
          .closest("a"),
      ).toHaveAttribute("href", SERVICE_PROVIDER.metadataUrl);
    });

    /** @scenario "The directory card carries the organization's real numbers" */
    it("says how many members the directory manages, and who arrived otherwise", async () => {
      await open();

      const card = screen.getByTestId("directory-card");
      // A FRACTION, not a count: what an administrator needs before removing
      // somebody from their identity provider is how many members that act
      // would NOT touch.
      expect(
        within(card).getByTestId("directory-card-members").textContent,
      ).toBe("3 of 4");
      expect(within(card).getByText(/arrived another way/i)).toBeTruthy();
      // Only the group the directory actually sent, named rather than counted.
      const groups = within(card).getAllByTestId("directory-card-group-chip");
      expect(groups.map((chip) => chip.textContent)).toEqual(["Engineering"]);
      expect(
        within(card)
          .getByText(/see who it manages/i)
          .closest("a"),
      ).toHaveAttribute("href", "/settings/directory");
    });

    /** @scenario "The page points at where the reader's own sign-in lives" */
    it("points at the reader's own profile for their personal sign-in", async () => {
      await open();

      expect(screen.getByText(/your profile/i).closest("a")).toHaveAttribute(
        "href",
        "/settings/profile",
      );
    });

    /** @scenario "Managing a live connection stays on the same page" */
    it("unfolds the setup journey under the cards rather than replacing them", async () => {
      const user = userEvent.setup();
      await open();

      expect(screen.queryByText(/prove a domain is yours/i)).toBeNull();

      await user.click(
        screen.getByRole("button", {
          name: /manage or turn off this connection/i,
        }),
      );

      expect(screen.getByText(/prove a domain is yours/i)).toBeTruthy();
      // THE CARDS STAY. Replacing them made one navigation entry into two
      // pages and took the overview away from the reader who pressed it.
      expect(screen.getByTestId("single-sign-on-card")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: /done managing/i }));
      expect(screen.queryByText(/prove a domain is yours/i)).toBeNull();
      expect(screen.getByTestId("single-sign-on-card")).toBeTruthy();
    });
  });

  describe("given a reader who may see single sign-on but not manage the organization", () => {
    /** @scenario "A reader who may not read membership is told so" */
    it("says the counts are unavailable rather than reading them as zero", async () => {
      readerHolding(["sso:view"]);
      mockGroups.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });
      mockProvenance.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });
      await open();

      const card = screen.getByTestId("directory-card");
      // Both membership reads say so rather than drawing a zero.
      expect(within(card).getAllByText("Unavailable").length).toBe(2);
      expect(within(card).queryByTestId("directory-card-members")).toBeNull();
      // And no control they would be refused.
      expect(
        screen.queryByRole("button", { name: /test sign-in/i }),
      ).toBeNull();
    });
  });

  describe("given an organization not switched on for setting it up itself", () => {
    const refused = () =>
      mockGetSetup.mockReturnValue({
        data: liveSetup({
          availability: { available: false, refusal: "not_opted_in" },
          connection: null,
          goLive: null,
          claims: [],
        }),
        isLoading: false,
      });

    /** @scenario "The reason sits above the page rather than replacing it" */
    it("puts the reason above a page that still explains the feature", async () => {
      refused();
      await open();

      // The reason, and what would change it.
      const refusal = screen.getByTestId("sso-availability-refusal");
      expect(refusal.textContent).toMatch(/isn't switched on yet/i);
      expect(refusal.textContent).toMatch(/talk to us/i);

      // And the page it sits above, rather than instead of.
      const preview = screen.getByTestId("single-sign-on-preview-card");
      expect(preview.textContent).toMatch(/what it does/i);
      expect(preview.textContent).toMatch(/identity provider/i);
      expect(preview.textContent).toMatch(/domain you prove/i);
      expect(screen.getByTestId("directory-card")).toBeTruthy();
      expect(screen.getByText(/your profile/i).closest("a")).toHaveAttribute(
        "href",
        "/settings/profile",
      );
    });

    /** @scenario "Nothing is offered that would be refused" */
    it("offers no control it would refuse, and no number it does not have", async () => {
      refused();
      await open();

      for (const refusedControl of [
        /register/i,
        /claim domain/i,
        /test sign-in/i,
        /go live/i,
        /manage or turn off this connection/i,
      ]) {
        expect(
          screen.queryByRole("button", { name: refusedControl }),
        ).toBeNull();
      }
      expect(screen.queryAllByRole("textbox")).toEqual([]);
      // Nothing about a connection that does not exist.
      expect(screen.queryByTestId("single-sign-on-card")).toBeNull();
      expect(screen.queryByTestId("authentication-domain-chip")).toBeNull();
    });
  });

  describe("given an organization that has never registered an identity provider", () => {
    /** @scenario "An organization with no connection gets the journey" */
    it("opens on the first step of setting one up, not on an empty overview", async () => {
      mockGetSetup.mockReturnValue({
        data: liveSetup({ connection: null, goLive: null, claims: [] }),
        isLoading: false,
      });
      await open();

      expect(screen.getByText(/connect your identity provider/i)).toBeTruthy();
      expect(screen.queryByTestId("single-sign-on-card")).toBeNull();
      expect(screen.queryByTestId("directory-card")).toBeNull();
    });
  });

  describe("given a connection that is not live yet", () => {
    it("stays on the journey, since there is nothing to overview", async () => {
      mockGetSetup.mockReturnValue({
        data: liveSetup({
          connection: { ...liveSetup().connection, state: "VERIFIED" },
          goLive: { ...GO_LIVE, activated: false, routingSwitchedOn: false },
        }),
        isLoading: false,
      });
      await open();

      expect(screen.queryByTestId("single-sign-on-card")).toBeNull();
      expect(screen.getByText(/prove a domain is yours/i)).toBeTruthy();
    });
  });
});
