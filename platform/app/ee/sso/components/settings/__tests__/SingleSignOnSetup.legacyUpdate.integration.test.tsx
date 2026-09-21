/**
 * @vitest-environment jsdom
 *
 * Taking over a single sign-on LangWatch set up (ADR-124 §6).
 *
 * The command that registers an organization's own identity provider beside
 * the one it signs in through has existed since the cutover was designed, and
 * no customer screen called it — so this suite asserts the door and what is
 * promised at it, and that the promises are the ones the service actually
 * keeps: today's sign-in carries on, nothing moves until somebody switches
 * over, and switching back is available.
 *
 * It also asserts what is NOT said. The code underneath calls this a
 * migration; an administrator has never heard the word, so no state this
 * screen renders may contain it.
 *
 * Spec: specs/identity/sso-idp-termination.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setupRef, hasPermissionMock, startUpdateMock, updateRef, toastMock } =
  vi.hoisted(() => ({
    setupRef: { current: undefined as unknown, error: null as unknown },
    hasPermissionMock: vi.fn(),
    startUpdateMock: vi.fn(),
    /** The last refusal the update mutation is carrying, if any. */
    updateRef: { error: null as unknown },
    toastMock: vi.fn(),
  }));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: toastMock } }));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ hasPermission: hasPermissionMock }),
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { sso: vi.fn() } },
  useSession: () => ({ data: { user: { email: "ana@acme.com" } } }),
}));

vi.mock("~/utils/api", () => {
  const idle = () => ({
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  });
  const empty = () => ({
    useQuery: () => ({ data: [], isLoading: false, error: null }),
  });
  return {
    api: {
      ssoSetup: {
        getSetup: {
          useQuery: () => ({
            isLoading: false,
            data: setupRef.current,
            error: setupRef.error,
          }),
        },
        register: idle(),
        startLegacyMigration: {
          useMutation: () => ({
            mutate: startUpdateMock,
            isPending: false,
            error: updateRef.error,
          }),
        },
        selectMigrationRoute: idle(),
        finalizeLegacyMigration: idle(),
        proveDomain: idle(),
        checkDomainRecord: idle(),
        checkDomainFile: idle(),
        setArrivals: idle(),
        claimDomain: idle(),
        removeDomain: idle(),
        activate: idle(),
        rename: idle(),
        grantBreakGlass: idle(),
        renewBreakGlass: idle(),
        revokeBreakGlass: idle(),
        discardConnection: idle(),
        removeConnection: idle(),
        breakGlassBindings: empty(),
        breakGlassCandidates: empty(),
        getHistory: empty(),
        getMigrationProgress: {
          useQuery: () => ({
            data: null,
            error: null,
            isFetching: false,
            refetch: vi.fn(),
          }),
        },
        onHistoryActivity: { useSubscription: () => undefined },
      },
      ssoConnections: { startLegacyMigration: idle() },
      useUtils: () => ({
        ssoSetup: {
          getSetup: { invalidate: vi.fn() },
          getHistory: { invalidate: vi.fn() },
          breakGlassBindings: { invalidate: vi.fn() },
        },
        ssoConnections: { invalidate: vi.fn() },
      }),
    },
  };
});

import { SingleSignOnSetup } from "../SingleSignOnSetup";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/{connection}",
  assertionConsumerServiceUrl:
    "https://app.test/api/auth/sso/saml2/sp/acs/{connection}",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/{connection}",
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl:
    "https://app.test/api/auth/sso/saml2/sp/metadata?providerId={connection}",
};

/** The organization signing in through the provider we set up for it. */
function grandfatheredSetup() {
  return {
    availability: { available: true, proof: "dns-record" },
    serviceProvider: {
      ...SERVICE_PROVIDER,
      redirectUrl: "https://app.test/api/auth/sso/callback/ssoc_legacy",
    },
    serviceProviderBeforeRegistration: SERVICE_PROVIDER,
    connection: {
      connectionId: "ssoc_legacy",
      state: "ACTIVE" as const,
      type: "oidc" as const,
      providerId: "auth0",
      issuer: "https://acme.eu.auth0.com",
      source: "legacy-grandfathered" as const,
      replacesConnectionId: null,
      migrationPhase: null,
      arrivalPolicy: "admit" as const,
      tearDownAfterMs: null,
      verifiedDomains: ["acme.com"],
      domainProofs: [],
    },
    legacyRoute: null,
    claims: [],
    record: null,
    goLive: null,
    migration: null,
    attestationOffered: false,
  };
}

function renderSetup() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SingleSignOnSetup organizationId="org_acme" />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  hasPermissionMock.mockReturnValue(true);
  setupRef.error = null;
  setupRef.current = grandfatheredSetup();
  updateRef.error = null;
  startUpdateMock.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given an organization signing in through a provider LangWatch set up", () => {
  describe("when an administrator opens single sign-on setup", () => {
    /** @scenario "Connecting your own identity provider keeps today's sign-in working" */
    it("offers the step that connects their own identity provider", () => {
      renderSetup();

      expect(screen.getByText("Update single sign-on")).toBeDefined();
      // The registration form's own first question, which is how we know it
      // is that form and not a second one written here.
      expect(screen.getByText("Who signs your team in?")).toBeDefined();
    });

    /** @scenario "Connecting your own identity provider keeps today's sign-in working" */
    it("promises today's sign-in carries on, that members do not move, and that they can switch back", () => {
      const { container } = renderSetup();

      expect(container.textContent).toContain(
        "Everyone keeps signing in through Auth0 while you set the new connection up and test it.",
      );
      expect(container.textContent).toContain(
        "Nothing changes for your members until an administrator switches sign-in over.",
      );
      expect(container.textContent).toContain(
        "You can switch back to Auth0 at any point before you finish the update.",
      );
    });

    /** @scenario "Connecting your own identity provider keeps today's sign-in working" */
    it("registers the identity provider against the connection it replaces", () => {
      renderSetup();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));
      fireEvent.change(screen.getByLabelText("Issuer address"), {
        target: { value: "https://acme.okta.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Register" }));

      expect(startUpdateMock).toHaveBeenCalledWith(
        {
          organizationId: "org_acme",
          legacyConnectionId: "ssoc_legacy",
          providerId: "Okta",
          idp: {
            protocol: "oidc",
            issuer: "https://acme.okta.com",
            clientId: "",
            clientSecret: "",
          },
        },
        expect.any(Object),
      );
    });

    /**
     * A refusal belongs beside the fields that caused it. Eight seconds in a
     * corner and gone is the wrong place for a step that is still stuck, and
     * the wire message for a handled error is the code slug — so the words
     * come from the code-keyed registry, never from `error.message` (#5984).
     */
    /** @scenario "Identity provider details that do not work are reported on the form" */
    it("reports a refused identity provider on the form, in the words its code has", () => {
      updateRef.error = {
        message: "sso_issuer_unreachable",
        data: {
          error: {
            code: "sso_issuer_unreachable",
            kind: "sso_issuer_unreachable",
            httpStatus: 422,
            fault: "customer",
            meta: {},
            reasons: [{ code: "unknown", kind: "unknown" }],
          },
        },
      };

      renderSetup();
      fireEvent.click(screen.getByTestId("identity-provider-okta"));

      expect(
        screen.getByText("That address did not answer as an identity provider"),
      ).toBeDefined();
      // Not a notification that disappears, and never the slug itself.
      expect(toastMock).not.toHaveBeenCalled();
      expect(screen.queryByText("sso_issuer_unreachable")).toBeNull();
    });

    /** @scenario "Connecting your own identity provider keeps today's sign-in working" */
    it("never calls any of it a migration", () => {
      const { container } = renderSetup();

      expect(container.textContent?.toLowerCase()).not.toContain("migrat");
    });
  });

  describe("when the reader may see single sign-on but not change it", () => {
    beforeEach(() => {
      hasPermissionMock.mockReturnValue(false);
    });

    /** @scenario "A reader who may not manage single sign-on is told who can update it" */
    it("says who can do it, with no form and no disabled action", () => {
      const { container } = renderSetup();

      expect(screen.getByText("Single sign-on is active")).toBeDefined();
      expect(container.textContent).toContain(
        "An organization administrator can connect your own identity provider here.",
      );
      expect(screen.queryByText("Who signs your team in?")).toBeNull();
      expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
    });
  });
});
