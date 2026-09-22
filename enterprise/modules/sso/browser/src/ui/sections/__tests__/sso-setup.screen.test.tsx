/**
 * @vitest-environment jsdom
 * The setup page as an administrator meets it: the journey assembled from one
 * read, and each press landing on the command it names.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { name: string; input: unknown };

const { state } = vi.hoisted(() => ({
  state: {
    view: null as unknown,
    isLoading: false,
    isError: false,
    calls: [] as Call[],
    invalidated: 0,
  },
}));

vi.mock("../../../behavior/sso-api.ts", () => {
  const mutation = (name: string) => ({
    useMutation: () => ({
      isPending: false,
      mutate: (input: unknown, options?: { onSuccess?: (answer: unknown) => void }) => {
        state.calls.push({ name, input });
        options?.onSuccess?.(void 0);
      },
    }),
  });

  return {
    ssoApi: {
      useUtils: () => ({
        ssoSetup: {
          getSetup: {
            invalidate: () => {
              state.invalidated += 1;
            },
          },
          getHistory: { invalidate: () => {} },
        },
      }),
      ssoSetup: {
        getSetup: {
          useQuery: () => ({
            data: state.view,
            isLoading: state.isLoading,
            isError: state.isError,
          }),
        },
        getHistory: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
        register: mutation("register"),
        startLegacyMigration: mutation("startLegacyMigration"),
        rename: mutation("rename"),
        setArrivals: mutation("setArrivals"),
        discardConnection: mutation("discardConnection"),
        removeConnection: mutation("removeConnection"),
        claimDomain: mutation("claimDomain"),
        proveDomain: mutation("proveDomain"),
        removeDomain: mutation("removeDomain"),
        checkDomainRecord: mutation("checkDomainRecord"),
        checkDomainFile: mutation("checkDomainFile"),
      },
    },
  };
});

vi.mock("../../../behavior/use-history-activity.ts", () => ({ useHistoryActivity: () => {} }));

import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";

import { FakeSsoHost, renderWithSsoHost } from "../../../testing.tsx";
import SsoSetupScreen from "../sso-setup.screen.tsx";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/ssoc_1",
  assertionConsumerServiceUrl: "https://app.test/api/auth/sso/saml2/sp/acs/ssoc_1",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/ssoc_1",
  entityId: "https://app.test/api/auth/sso/saml2/sp/metadata/ssoc_1",
  metadataUrl: "https://app.test/api/auth/sso/saml2/sp/metadata/ssoc_1",
};

function connectionView(
  overrides: Partial<NonNullable<SsoSetupPageView["connection"]>> = {},
): NonNullable<SsoSetupPageView["connection"]> {
  return {
    connectionId: "ssoc_1",
    state: "VERIFIED",
    type: "oidc",
    providerId: "Okta",
    issuer: "https://acme.okta.com",
    source: "self-serve",
    arrivalPolicy: "admit",
    arrivalPolicyDecidedAtMs: null,
    tearDownAfterMs: null,
    createdAtMs: 1_764_000_000_000,
    verifiedDomains: ["acme.com"],
    domainProofs: [
      {
        domain: "acme.com",
        method: "dns-txt",
        qualification: "QUALIFIED",
        proofState: "VERIFIED",
        graceEndsAtMs: null,
        verifiedAtMs: 1_764_000_000_000,
        verifier: { type: "user", id: "user_ana" },
      },
    ],
    ...overrides,
  };
}

function setupView(overrides: Partial<SsoSetupPageView> = {}): SsoSetupPageView {
  return {
    connection: connectionView(),
    claims: [],
    record: null,
    goLive: {
      domainProved: true,
      testSignIn: { done: false },
      breakGlass: { inPlace: false, liveCount: 0 },
      arrivalsDecided: false,
      ready: false,
      activated: false,
    },
    legacyRoute: null,
    migration: null,
    serviceProvider: SERVICE_PROVIDER,
    ...overrides,
  };
}

beforeEach(() => {
  state.view = setupView();
  state.isLoading = false;
  state.isError = false;
  state.calls = [];
  state.invalidated = 0;
});

afterEach(cleanup);

describe("the single sign-on setup page", () => {
  describe("given a read that has not answered", () => {
    it("offers no journey, because a page that invents one invites a second provider", () => {
      state.isLoading = true;
      state.view = null;

      renderWithSsoHost(<SsoSetupScreen />);

      expect(screen.queryByTestId("sso-setup")).toBeNull();
    });
  });

  describe("given a read that failed", () => {
    it("says so rather than showing the organization as unregistered", () => {
      state.isError = true;
      state.view = null;

      renderWithSsoHost(<SsoSetupScreen />);

      expect(screen.getByTestId("sso-setup-unavailable")).toBeInTheDocument();
      expect(screen.queryByText(/No identity provider is registered/)).toBeNull();
    });
  });

  describe("given an organization whose sign-in is already routed the old way", () => {
    /** @scenario "An organization already routing sign-in is not offered a second connection" */
    it("shows the route it already signs in through, and offers no second connection", () => {
      state.view = setupView({
        connection: null,
        goLive: null,
        legacyRoute: { domain: "acme.com", provider: "okta" },
      });

      renderWithSsoHost(<SsoSetupScreen />);

      expect(screen.getByTestId("sso-legacy-route")).toBeInTheDocument();
      expect(screen.queryByTestId("sso-setup")).toBeNull();
    });
  });

  describe("given an organization with no connection", () => {
    /** @scenario "An organization with no sign-in route is offered the setup journey" */
    /** @scenario "An organization with no connection gets the journey" */
    it("opens on the register step, with the form that starts one", () => {
      state.view = setupView({ connection: null, goLive: null });

      renderWithSsoHost(<SsoSetupScreen />);

      expect(screen.getByText("Connect your identity provider")).toBeInTheDocument();
      expect(screen.getByTestId("sso-register-connection")).toBeInTheDocument();
      expect(screen.getByText("Who signs your team in?")).toBeInTheDocument();
      expect(screen.queryByTestId("connection-domains")).toBeNull();
    });

    it("refreshes the read the moment a provider is registered", () => {
      state.view = setupView({ connection: null, goLive: null });

      renderWithSsoHost(<SsoSetupScreen />);
      fireEvent.click(screen.getByTestId("identity-provider-saml"));
      fireEvent.change(screen.getByLabelText("Sign-in address"), {
        target: { value: "https://sso.acme.com/saml2/sso" },
      });
      fireEvent.click(screen.getByTestId("sso-register"));

      expect(state.calls.map((call) => call.name)).toEqual(["register"]);
      expect(state.invalidated).toBe(1);
    });
  });

  describe("given the connection's own card", () => {
    /** @scenario "The name is offered for editing on the connection's card" */
    it("offers the name for editing in place, and saves what was typed", () => {
      renderWithSsoHost(<SsoSetupScreen />);

      fireEvent.click(screen.getByTestId("connection-name-edit"));
      fireEvent.change(screen.getByTestId("connection-name-input"), {
        target: { value: "Corporate sign-in" },
      });
      fireEvent.click(screen.getByTestId("connection-name-save"));

      expect(state.calls).toEqual([
        {
          name: "rename",
          input: {
            organizationId: "org-1",
            connectionId: "ssoc_1",
            name: "Corporate sign-in",
          },
        },
      ]);
      expect(state.invalidated).toBe(1);
    });

    it("offers a reader who may not manage it no way to change it", () => {
      renderWithSsoHost(<SsoSetupScreen />, new FakeSsoHost({ canManage: false }));

      expect(screen.getByTestId("connection-name")).toBeInTheDocument();
      expect(screen.queryByTestId("connection-name-edit")).toBeNull();
    });
  });

  describe("given a registered connection", () => {
    it("assembles the journey out of the one read", () => {
      renderWithSsoHost(<SsoSetupScreen />);

      expect(screen.getByText("Your identity provider")).toBeInTheDocument();
      expect(screen.getByTestId("service-provider")).toBeInTheDocument();
      expect(screen.getByTestId("connection-domains")).toBeInTheDocument();
      expect(screen.getByText("Sign in through it once")).toBeInTheDocument();
      expect(screen.getByTestId("connection-arrivals")).toBeInTheDocument();
      expect(screen.getByTestId("connection-history")).toBeInTheDocument();
      expect(screen.getByTestId("sso-remove")).toBeInTheDocument();
    });

    it("shows the proved domain the read named, under the connection it belongs to", () => {
      renderWithSsoHost(<SsoSetupScreen />);

      expect(screen.getByTestId("connection-domains-table")).toHaveTextContent("acme.com");
    });

    /** @scenario "The initial arrival choice can be confirmed without changing the default" */
    it("sends the confirmed answer to setArrivals and reads the setup again", () => {
      renderWithSsoHost(<SsoSetupScreen />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm choice" }));

      expect(state.calls).toEqual([
        {
          name: "setArrivals",
          input: { organizationId: "org-1", connectionId: "ssoc_1", policy: "admit" },
        },
      ]);
      expect(state.invalidated).toBe(1);
    });

    /** @scenario "An administrator removes their own live connection on teardown's terms" */
    it("tears a live connection down, naming no reason the administrator did not give", () => {
      state.view = setupView({ connection: connectionView({ state: "ACTIVE" }) });

      renderWithSsoHost(<SsoSetupScreen />);
      fireEvent.click(screen.getByTestId("sso-remove-open"));
      fireEvent.click(screen.getByTestId("sso-remove-confirm"));

      expect(state.calls).toEqual([
        {
          name: "removeConnection",
          input: { organizationId: "org-1", connectionId: "ssoc_1", reason: null },
        },
      ]);
      expect(screen.getByTestId("sso-remove-settling")).toBeInTheDocument();
    });

    /** @scenario "An administrator removes their own connection that never went live" */
    it("discards a connection that never went live", () => {
      state.view = setupView({ connection: connectionView({ state: "DRAFT" }) });

      renderWithSsoHost(<SsoSetupScreen />);
      fireEvent.click(screen.getByTestId("sso-remove-open"));
      fireEvent.click(screen.getByTestId("sso-remove-confirm"));

      expect(state.calls).toEqual([
        { name: "discardConnection", input: { organizationId: "org-1", connectionId: "ssoc_1" } },
      ]);
    });
  });

  describe("given a reader who may see single sign-on but not manage it", () => {
    /** @scenario "Only administrators can confirm the initial arrival choice" */
    it("reads the journey with no control on it, and neither history nor removal", () => {
      renderWithSsoHost(<SsoSetupScreen />, new FakeSsoHost({ canManage: false }));

      expect(screen.getByTestId("connection-arrivals")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm choice" })).toBeNull();
      expect(screen.queryByTestId("connection-history")).toBeNull();
      expect(screen.queryByTestId("sso-remove")).toBeNull();
    });
  });
});
