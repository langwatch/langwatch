/**
 * @vitest-environment jsdom
 * The sign-on card on organization's Authentication overview.
 * @see specs/identity/organization-authentication-settings.feature
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

afterEach(cleanup);

type Connection = NonNullable<SsoSetupPageView["connection"]>;

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  connectionId: "conn-1",
  state: "ACTIVE",
  type: "oidc",
  providerId: "okta",
  issuer: "https://acme.okta.com",
  source: "self-serve",
  arrivalPolicy: "request",
  arrivalPolicyDecidedAtMs: 1,
  tearDownAfterMs: null,
  createdAtMs: 1,
  verifiedDomains: ["acme.com"],
  domainProofs: [
    {
      domain: "acme.com",
      method: "dns-txt",
      qualification: "LAPSED",
      proofState: "LAPSED",
      graceEndsAtMs: null,
      verifiedAtMs: 1,
      verifier: { type: "user", id: "ana" },
    },
  ],
  ...overrides,
});

const viewWith = (live: Connection | null): SsoSetupPageView => ({
  connection: live,
  claims: [],
  record: null,
  goLive: null,
  legacyRoute: null,
  migration: null,
  serviceProvider: {
    redirectUrl: "https://app/redirect",
    assertionConsumerServiceUrl: "https://app/acs",
    singleLogoutUrl: "https://app/slo",
    entityId: "https://app/entity",
    metadataUrl: "https://app/metadata",
  },
});

beforeEach(() => {
  state.view = null;
});

const renderCard = () =>
  renderWithSsoHost(<SsoOverviewCard organizationId="org-1" />, new FakeSsoHost());

describe("given a live OpenID Connect connection to okta", () => {
  beforeEach(() => {
    state.view = viewWith(connection());
  });

  /** @scenario "The overview names the connection by the protocol it speaks" */
  it("titles the card for OpenID Connect, names okta and says where it stands in words", () => {
    renderCard();

    const card = screen.getByTestId("single-sign-on-card");
    expect(card).toHaveTextContent("OpenID Connect single sign-on");
    expect(card).toHaveTextContent("okta");
    expect(card).toHaveTextContent("Active");
    expect(card).not.toHaveTextContent("ACTIVE");
  });

  /** @scenario "A domain whose record has gone says so on the overview" */
  it("lists a domain whose record lapsed as missing its record", () => {
    renderCard();

    expect(screen.getByTestId("authentication-domain-chip")).toHaveTextContent(
      "acme.com · Record missing",
    );
  });

  /** @scenario "The overview offers only what the connection really has" */
  it("offers a test sign-in and no metadata, since only SAML publishes it", () => {
    renderCard();

    expect(screen.getByText("Test sign-in")).toBeInTheDocument();
    expect(screen.queryByText("Metadata")).toBeNull();
  });
});

describe("given no connection yet", () => {
  it("draws what single sign-on would do and offers the journey", () => {
    state.view = viewWith(null);
    renderCard();

    const card = screen.getByTestId("single-sign-on-preview-card");
    expect(card).toHaveTextContent("Not set up");
    expect(screen.getByText("Set it up").closest("a")).toHaveAttribute(
      "href",
      "/settings/authentication/provider",
    );
  });
});
