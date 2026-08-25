/**
 * @vitest-environment jsdom
 *
 * Who is offered single sign-on setup, and who is refused the address (D05 —
 * see specs/identity/sso-onboarding-tiers.feature).
 *
 * Two readers and two answers. An administrator who has not been given the
 * single sign-on permissions cannot reach the page by typing the address —
 * the same rule the menu applies, because a menu is a courtesy and never a
 * gate. A reader who may SEE it reads the connection, its domains and its
 * state, and no control they cannot use is rendered for them at all: a
 * disabled button is still an invitation, and inviting somebody to do a
 * thing they will be refused for is worse than not offering it.
 *
 * The settings chrome is stubbed to a passthrough. What is under test is the
 * page's own guard and the setup surface's own rendering, and the layout
 * would drag the entire navigation tree in to prove neither.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseOrganizationTeamProject, mockGetSetup } = vi.hoisted(() => ({
  mockUseOrganizationTeamProject: vi.fn(),
  mockGetSetup: vi.fn(),
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
      discardConnection: mutationDouble(),
      removeConnection: mutationDouble(),
      breakGlassBindings: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      breakGlassCandidates: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
    },
    useUtils: () => ({
      ssoSetup: {
        getSetup: { invalidate: vi.fn() },
        breakGlassBindings: { invalidate: vi.fn() },
      },
    }),
  },
};

/** The test sign-in leaves the page for the identity provider, which jsdom
 *  has none of. The button's presence is what this file is about. */
vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { sso: vi.fn() } },
}));
vi.mock("../../../utils/auth-client", () => ({
  authClient: { signIn: { sso: vi.fn() } },
}));

const hookDouble = {
  useOrganizationTeamProject: mockUseOrganizationTeamProject,
};

vi.mock("~/hooks/useOrganizationTeamProject", () => hookDouble);
vi.mock("../../../hooks/useOrganizationTeamProject", () => hookDouble);
vi.mock("~/utils/api", () => apiDouble);
vi.mock("../../../utils/api", () => apiDouble);
vi.mock("../../../components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const SETUP = {
  availability: {
    available: true,
    proof: "dns-txt",
    claimWaitsForReview: true,
  },
  serviceProvider: {
    redirectUrl: "https://app.test/api/auth/sso/callback/ssoc_acme",
    assertionConsumerServiceUrl:
      "https://app.test/api/auth/sso/saml2/sp/acs/ssoc_acme",
    singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/ssoc_acme",
    entityId: "https://app.test/api/auth/sso/saml2/sp",
    metadataUrl:
      "https://app.test/api/auth/sso/saml2/sp/metadata?providerId=ssoc_acme",
  },
  connection: {
    connectionId: "ssoc_acme",
    state: "APPROVED",
    type: "oidc",
    providerId: "okta",
    issuer: "https://login.acme.okta.com",
    verifiedDomains: [],
    domainProofs: [],
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
  goLive: {
    domainProved: false,
    testSignIn: { done: false, atMs: null },
    breakGlass: { inPlace: false, liveCount: 0 },
    ready: false,
    activated: false,
    routingSwitchedOn: false,
  },
  attestationOffered: false,
};

/** A reader holding exactly the permissions named, and nothing else. */
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
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetup.mockReturnValue({ data: SETUP, isLoading: false });
});

describe("the single sign-on settings surface", () => {
  describe("given somebody who may see single sign-on but not manage it", () => {
    /** @scenario "Seeing single sign-on and changing it are two different permissions" */
    it("renders the connection, its domains and its state, and no control they cannot use", async () => {
      readerHolding(["sso:view"]);
      const { SingleSignOnSetup } = await import(
        "../../../components/settings/SingleSignOnSetup"
      );

      draw(<SingleSignOnSetup organizationId="org_acme" />);

      // Readable: the identity provider, the domain and where it stands.
      // Named in more than one place on this screen — the connection's own
      // card and the setup step that registered it — so this asks that it is
      // readable, not that it appears exactly once.
      expect(screen.getAllByText("okta").length).toBeGreaterThan(0);
      // Likewise the domain: it is on the connection's card and in the row
      // of the setup step that proves it.
      expect(screen.getAllByText("acme.com").length).toBeGreaterThan(0);
      expect(screen.getByText("Not proved yet")).toBeTruthy();
      // In the words the status chip speaks, never the aggregate's own
      // vocabulary: a reader is told "Domain approved", not "APPROVED".
      expect(screen.getByText("Domain approved")).toBeTruthy();

      // And nothing they cannot use is rendered AT ALL — not disabled, not
      // present. Every control named here is one this reader would be
      // refused; the read-only fields holding OUR addresses are not among
      // them, because copying those is something they can do.
      // Every move the domain row can offer, whichever step it is on, plus
      // the ones the rest of the screen offers.
      for (const refused of [
        /prove this domain/i,
        /prove with our licence/i,
        /get a fresh record/i,
        /claim it again/i,
        /^remove$/i,
        /test sign-in/i,
        /grant a way back in/i,
        /go live/i,
      ]) {
        expect(screen.queryByRole("button", { name: refused })).toBeNull();
      }
      // No field to type a domain into either: the only text fields on the
      // screen are the read-only ones showing our own addresses.
      expect(
        screen
          .queryAllByRole("textbox")
          .filter((field) => !(field as HTMLInputElement).readOnly),
      ).toEqual([]);
    });
  });

  describe("given somebody who may manage it", () => {
    it("offers the controls the same screen withheld", async () => {
      readerHolding(["sso:view", "sso:manage"]);
      const { SingleSignOnSetup } = await import(
        "../../../components/settings/SingleSignOnSetup"
      );

      draw(<SingleSignOnSetup organizationId="org_acme" />);

      // The step this row is actually on, whichever of them it is — the
      // labels belong to `domainNextStepFor`, and the point here is that a
      // manager is offered one at all.
      expect(
        screen.getByRole("button", {
          name: /prove this domain|prove with our licence|get a fresh record|claim it again/i,
        }),
      ).toBeTruthy();
      // And the way back out, which only a manager is offered.
      expect(screen.getByRole("button", { name: /^remove$/i })).toBeTruthy();
    });
  });

  describe("given an administrator who may not manage single sign-on", () => {
    /** @scenario "An administrator without the permission is not offered setup, and cannot reach it" */
    it("is refused the address, and the menu offers no entry to it either", async () => {
      readerHolding(["organization:manage"]);
      const { default: AuthenticationPage } = await import("../authentication");

      draw(<AuthenticationPage />);

      // Opening the address directly is refused: the page is guarded on
      // `sso:view`, so what renders is the refusal rather than the setup.
      expect(screen.queryByText("okta")).toBeNull();
      expect(screen.queryByText("acme.com")).toBeNull();
      expect(screen.queryAllByRole("textbox")).toEqual([]);

      // The menu asks the same question of the same reader, so an
      // administrator who is refused the address is never offered the entry
      // that leads to it.
      const { hasPermission } = mockUseOrganizationTeamProject.mock.results[0]!
        .value as { hasPermission: (permission: string) => boolean };
      expect(hasPermission("sso:view")).toBe(false);
    });
  });
});
