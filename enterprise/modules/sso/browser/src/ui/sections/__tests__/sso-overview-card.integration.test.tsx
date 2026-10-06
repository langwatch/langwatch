/**
 * @vitest-environment jsdom
 * The sign-on card on organization's Authentication overview.
 * @see specs/identity/organization-authentication-settings.feature
 */
import "@testing-library/jest-dom/vitest";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { cleanup, screen, within } from "@testing-library/react";
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
  availability: { available: true, proof: "dns-txt" },
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

  /** @scenario "A connection that is on but carrying nobody says both" */
  it("says who the connection routes beside whether it is on, in two separate chips", () => {
    renderCard();

    const card = within(screen.getByTestId("single-sign-on-card"));
    const routing = card.getByTestId("sso-routing-chip");
    expect(routing).toHaveTextContent("Everybody");
    expect(card.getByText("Active")).toBeInTheDocument();
    expect(routing).not.toHaveTextContent("Active");
    expect(card.getByText("Active")).not.toBe(routing);
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

describe("given an organization not switched on for setting it up itself", () => {
  beforeEach(() => {
    state.view = {
      ...viewWith(null),
      availability: { available: false, refusal: "not_opted_in" },
    };
  });

  /** @scenario "The reason sits above the page rather than replacing it" */
  it("puts the reason above a card that still says what single sign-on would do", () => {
    renderCard();

    const refusal = screen.getByTestId("sso-availability-refusal");
    expect(refusal).toHaveTextContent(/isn't switched on yet/i);
    expect(refusal).toHaveTextContent(/talk to us/i);
    expect(screen.getByTestId("single-sign-on-preview-card")).toHaveTextContent(/what it does/i);
  });

  /** @scenario "Nothing is offered that would be refused" */
  it("offers no way to register, and shows nothing for a connection that does not exist", () => {
    renderCard();

    expect(screen.queryByTestId("single-sign-on-preview-action")).toBeNull();
    expect(screen.queryByTestId("single-sign-on-card")).toBeNull();
    expect(screen.queryByTestId("authentication-domain-chip")).toBeNull();
  });
});
