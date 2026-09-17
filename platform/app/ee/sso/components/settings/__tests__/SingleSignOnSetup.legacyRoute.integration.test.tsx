/**
 * @vitest-environment jsdom
 *
 * What the setup screen offers an organization that is ALREADY signing people
 * in through a provider, before anyone has recorded that as a connection.
 *
 * `connection: null` carried two meanings and the screen could only read one.
 * "Nobody has set single sign-on up" and "this was set up years ago and is
 * routing people right now" arrived as the same null, so a legacy organization
 * was shown the vendor picker — and following it registered a SECOND
 * connection on a domain the live route already answers, with no predecessor
 * named, no proof inherited and no way back.
 *
 * Asserting on the notice alone would pass against exactly that bug, so each
 * scenario also asserts what is NOT offered.
 *
 * Spec: specs/identity/sso-connection-lifecycle.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setupRef, hasPermissionMock } = vi.hoisted(() => ({
  setupRef: { current: undefined as unknown, error: null as unknown },
  hasPermissionMock: vi.fn(),
}));

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
        startLegacyMigration: idle(),
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
        onHistoryActivity: { useSubscription: () => undefined },
      },
      ssoConnections: {
        startLegacyMigration: idle(),
      },
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
  redirectUrl: "https://app.test/api/auth/sso/callback/ssoc_acme",
  assertionConsumerServiceUrl: "https://app.test/acs",
  singleLogoutUrl: "https://app.test/slo",
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl: "https://app.test/metadata",
};

/** No connection recorded, which is the state both scenarios start from. */
function setupWith({
  legacyRoute,
}: {
  legacyRoute: { domain: string; provider: string } | null;
}) {
  return {
    availability: { available: true, proof: "dns-record" },
    serviceProvider: SERVICE_PROVIDER,
    serviceProviderBeforeRegistration: SERVICE_PROVIDER,
    connection: null,
    legacyRoute,
    claims: [],
    record: null,
    goLive: null,
    migration: null,
    attestationOffered: false,
  };
}

function renderSetup() {
  render(
    <ChakraProvider value={defaultSystem}>
      <SingleSignOnSetup organizationId="org_acme" />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  hasPermissionMock.mockReturnValue(true);
  setupRef.error = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given an organization already routing sign-in through a provider", () => {
  describe("when an administrator opens the setup screen", () => {
    /** @scenario "An organization already routing sign-in is not offered a second connection" */
    it("names the route it is on and does not offer to connect a provider", () => {
      setupRef.current = setupWith({
        legacyRoute: { domain: "acme.com", provider: "auth0" },
      });

      renderSetup();

      expect(screen.getByTestId("sso-legacy-route")).toBeDefined();
      expect(screen.getByText("acme.com")).toBeDefined();
      // The half that matters: the rival is not on offer.
      expect(screen.queryByText("Connect your identity provider")).toBeNull();
    });
  });
});

describe("given an organization that has never set sign-in up", () => {
  describe("when an administrator opens the setup screen", () => {
    /** @scenario "An organization with no sign-in route is offered the setup journey" */
    it("offers the setup journey exactly as before", () => {
      setupRef.current = setupWith({ legacyRoute: null });

      renderSetup();

      expect(screen.getByText("Connect your identity provider")).toBeDefined();
      expect(screen.queryByTestId("sso-legacy-route")).toBeNull();
    });

    /** @scenario "An organization with no sign-in route is offered the setup journey" */
    it("offers it when the field is absent entirely, not merely null", () => {
      // A payload from a server that predates the field, which is what every
      // reader gets for the length of a deploy. Written as `!== null` this
      // branch swallowed the setup journey for everybody — absent has to mean
      // absent, not "has a route".
      const { legacyRoute: _omitted, ...withoutTheField } = setupWith({
        legacyRoute: null,
      });
      setupRef.current = withoutTheField;

      renderSetup();

      expect(screen.getByText("Connect your identity provider")).toBeDefined();
      expect(screen.queryByTestId("sso-legacy-route")).toBeNull();
    });
  });
});
