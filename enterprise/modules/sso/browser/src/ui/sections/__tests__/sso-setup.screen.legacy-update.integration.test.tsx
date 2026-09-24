/**
 * @vitest-environment jsdom
 * Taking over a single sign-on LangWatch set up (ADR-124 §6): the door, what is
 * promised at it, and never the word the code uses for it.
 * Spec: specs/identity/sso-idp-termination.feature
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { name: string; input: unknown };

const { state } = vi.hoisted(() => ({
  state: {
    view: null as unknown,
    calls: [] as Call[],
    refusal: null as unknown,
  },
}));

vi.mock("../../../behavior/sso-api.ts", () => {
  const mutation = (name: string) => ({
    useMutation: () => ({
      isPending: false,
      error: name === "startLegacyMigration" ? state.refusal : null,
      mutate: (input: unknown) => {
        state.calls.push({ name, input });
      },
    }),
  });

  return {
    ssoApi: {
      useUtils: () => ({
        ssoSetup: {
          getSetup: { invalidate: () => {} },
          getHistory: { invalidate: () => {} },
          breakGlassBindings: { invalidate: () => {} },
        },
      }),
      ssoSetup: {
        getSetup: {
          useQuery: () => ({ data: state.view, isLoading: false, isError: false, error: null }),
        },
        register: mutation("register"),
        startLegacyMigration: mutation("startLegacyMigration"),
        setArrivals: mutation("setArrivals"),
      },
    },
  };
});

vi.mock("../../../behavior/use-history-activity.ts", () => ({ useHistoryActivity: () => {} }));

import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";

import { FakeSsoHost, renderWithSsoHost } from "../../../testing.tsx";
import SsoSetupScreen from "../sso-setup.screen.tsx";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/ssoc_legacy",
  assertionConsumerServiceUrl: "https://app.test/api/auth/sso/saml2/sp/acs/ssoc_legacy",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/ssoc_legacy",
  entityId: "https://app.test/api/auth/sso/saml2/sp/metadata/ssoc_legacy",
  metadataUrl: "https://app.test/api/auth/sso/saml2/sp/metadata/ssoc_legacy",
};

/** The organization signing in through the provider we set up for it. */
function grandfatheredSetup(): SsoSetupPageView {
  return {
    connection: {
      connectionId: "ssoc_legacy",
      state: "ACTIVE",
      type: "oidc",
      providerId: "auth0",
      issuer: "https://acme.eu.auth0.com",
      source: "legacy-grandfathered",
      arrivalPolicy: "admit",
      arrivalPolicyDecidedAtMs: null,
      tearDownAfterMs: null,
      createdAtMs: 1_764_000_000_000,
      verifiedDomains: ["acme.com"],
      domainProofs: [],
    },
    claims: [],
    record: null,
    goLive: null,
    legacyRoute: null,
    migration: null,
    serviceProvider: SERVICE_PROVIDER,
  };
}

function renderSetup({ canManage = true }: { canManage?: boolean } = {}) {
  const host = new FakeSsoHost({ organizationId: "org_acme", canManage });
  return renderWithSsoHost(<SsoSetupScreen />, host);
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  state.view = grandfatheredSetup();
  state.calls = [];
  state.refusal = null;
});

afterEach(cleanup);

describe("given an organization signing in through a provider LangWatch set up", () => {
  describe("when an administrator opens single sign-on setup", () => {
    /** @scenario "Connecting your own identity provider keeps today's sign-in working" */
    it("offers the step that connects their own identity provider", () => {
      renderSetup();

      expect(screen.getByText("Update single sign-on")).toBeInTheDocument();
      expect(screen.getByText("Who signs your team in?")).toBeInTheDocument();
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
        "You can switch back to Auth0 at any point until you start finishing the update.",
      );
    });

    /** @scenario "A grandfathered connection remains active until an explicit replacement is ready" */
    it("shows ordinary active status without a generic migration action", () => {
      renderSetup();

      expect(screen.getByText("Single sign-on is active")).toBeInTheDocument();
      expect(screen.getByText(/Your people sign in through Auth0 today/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Migrate from Auth0/ })).toBeNull();
    });

    it("asks who can join through today's provider, saving the answer against that connection", () => {
      renderSetup();

      expect(screen.getByText("Who can join through Auth0")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Confirm choice" }));

      expect(state.calls).toEqual([
        {
          name: "setArrivals",
          input: { organizationId: "org_acme", connectionId: "ssoc_legacy", policy: "admit" },
        },
      ]);
    });

    /** @scenario "Connecting your own identity provider keeps today's sign-in working" */
    it("registers the identity provider against the connection it replaces", () => {
      renderSetup();

      fireEvent.click(screen.getByTestId("identity-provider-okta"));
      fill("Issuer address", "https://acme.okta.com");
      fill("Client id", "0oa1");
      fill("Client secret", "s3cret");
      fireEvent.click(screen.getByRole("button", { name: "Register replacement" }));

      expect(state.calls).toEqual([
        {
          name: "startLegacyMigration",
          input: {
            organizationId: "org_acme",
            legacyConnectionId: "ssoc_legacy",
            providerId: "Okta",
            idp: {
              protocol: "oidc",
              issuer: "https://acme.okta.com",
              clientId: "0oa1",
              clientSecret: "s3cret",
            },
          },
        },
      ]);
    });

    /** @scenario "Identity provider details that do not work are reported on the form" */
    it("reports a refused identity provider on the form, never as a notification or the slug", () => {
      state.refusal = {
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

      const { host } = renderSetup();
      fireEvent.click(screen.getByTestId("identity-provider-okta"));

      expect(screen.getByTestId("sso-inline-refusal")).toBeInTheDocument();
      expect(host.failures).toEqual([]);
      expect(screen.queryByText("sso_issuer_unreachable")).toBeNull();
    });

    /** @scenario "Connecting your own identity provider keeps today's sign-in working" */
    it("never calls any of it a migration", () => {
      const { container } = renderSetup();

      expect(container.textContent?.toLowerCase()).not.toContain("migrat");
    });
  });

  describe("when the reader may see single sign-on but not change it", () => {
    /** @scenario "A reader who may not manage single sign-on is told who can update it" */
    it("says who can do it, with no form and no disabled action", () => {
      const { container } = renderSetup({ canManage: false });

      expect(screen.getByText("Single sign-on is active")).toBeInTheDocument();
      expect(container.textContent).toContain(
        "An organization administrator can connect your own identity provider here.",
      );
      expect(screen.queryByText("Who signs your team in?")).toBeNull();
      expect(screen.queryByRole("button", { name: /Register/ })).toBeNull();
    });
  });
});
