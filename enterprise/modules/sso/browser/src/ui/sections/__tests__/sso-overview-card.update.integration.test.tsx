/**
 * @vitest-environment jsdom
 * The Authentication overview for an organization whose single sign-on LangWatch
 * set up, and for one replacing it (ADR-124 §6).
 * Spec: specs/identity/sso-idp-termination.feature
 */
import "@testing-library/jest-dom/vitest";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSsoHost, renderWithSsoHost } from "../../../testing.tsx";
import { SsoOverviewCard } from "../sso-overview-card.tsx";

const { state } = vi.hoisted(() => ({ state: { view: null as unknown } }));

vi.mock("../../../behavior/sso-api.ts", () => ({
  ssoApi: {
    ssoSetup: {
      getSetup: {
        useQuery: () => ({ data: state.view, isLoading: false, isError: false, error: null }),
      },
    },
  },
}));

type Connection = NonNullable<SsoSetupPageView["connection"]>;
type Migration = NonNullable<SsoSetupPageView["migration"]>;

const connection = (source: Connection["source"]): Connection => ({
  connectionId: "ssoc_legacy",
  state: "ACTIVE",
  type: "oidc",
  providerId: "auth0",
  issuer: "https://acme.eu.auth0.com",
  source,
  arrivalPolicy: "admit",
  arrivalPolicyDecidedAtMs: 1,
  tearDownAfterMs: null,
  createdAtMs: 1,
  verifiedDomains: ["acme.com"],
  domainProofs: [],
});

const migrationIn = (phase: Migration["phase"]): Migration => ({
  legacy: { connectionId: "ssoc_legacy", source: "legacy-grandfathered", providerId: "auth0" },
  replacement: { connectionId: "ssoc_new", source: "self-serve", providerId: "okta" },
  phase,
  selectedRoute: "direct",
  inheritedDomains: [],
  testSignIn: { done: true, atMs: 1 },
  members: { activeCount: 1, linkedCount: 1, nextSignInCount: 0, stragglers: [], nextCursor: null },
  quietPeriod: { lastLegacyAuthenticationAtMs: null, clearsAtMs: null, complete: true },
  scim: { status: "not-applicable" },
  blockers: [],
  canFinalize: true,
});

const viewWith = ({
  source = "legacy-grandfathered",
  migration = null,
}: {
  source?: Connection["source"];
  migration?: Migration | null;
} = {}): SsoSetupPageView => ({
  connection: connection(source),
  claims: [],
  record: null,
  goLive: null,
  legacyRoute: null,
  migration,
  serviceProvider: {
    redirectUrl: "https://app.test/redirect",
    assertionConsumerServiceUrl: "https://app.test/acs",
    singleLogoutUrl: "https://app.test/slo",
    entityId: "https://app.test/entity",
    metadataUrl: "https://app.test/metadata",
  },
});

const renderCard = ({ canManage = true }: { canManage?: boolean } = {}) =>
  renderWithSsoHost(<SsoOverviewCard organizationId="org-1" />, new FakeSsoHost({ canManage }));

beforeEach(() => {
  state.view = viewWith();
});

afterEach(cleanup);

describe("given single sign-on LangWatch set up for the organization", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("says they can connect their own, with one action that goes there", () => {
      renderCard();

      expect(screen.getByTestId("sso-update-notice")).toHaveTextContent(
        "LangWatch set this single sign-on up for your organization. Connect your own identity provider to run it yourself.",
      );
      expect(screen.getByRole("link", { name: /Update single sign-on/ })).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
    });

    /** @scenario "A reader who may not manage single sign-on is told who can update it" */
    it("shows the same notice without an action to a reader who may not act", () => {
      renderCard({ canManage: false });

      expect(screen.getByTestId("sso-update-notice")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Update single sign-on/ })).toBeNull();
    });

    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("never calls any of it a migration", () => {
      const { container } = renderCard();

      expect(container.textContent?.toLowerCase()).not.toContain("migrat");
    });
  });
});

describe("given an organization that registered its own identity provider", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "Once it is under way, the overview says where the update got to" */
    it("wears the same status word the single sign-on page uses, and links to it", () => {
      state.view = viewWith({ migration: migrationIn("GRACE_DIRECT") });
      renderCard();

      expect(screen.getByTestId("sso-update-chip")).toHaveTextContent("Switched over");
      expect(screen.getByRole("link", { name: "Where it stands" })).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
      expect(screen.queryByTestId("sso-update-notice")).toBeNull();
    });
  });
});

describe("given an organization that registered its identity provider itself", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("is offered nothing to update", () => {
      state.view = viewWith({ source: "self-serve" });
      renderCard();

      expect(screen.queryByTestId("sso-update-notice")).toBeNull();
      expect(screen.queryByTestId("sso-update-chip")).toBeNull();
    });
  });
});
