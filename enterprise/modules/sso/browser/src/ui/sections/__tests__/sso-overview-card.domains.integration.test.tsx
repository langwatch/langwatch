/**
 * @vitest-environment jsdom
 * The domains on organization's Authentication overview, ported from main's
 * DomainVerificationSection tests.
 * @see specs/identity/organization-authentication-settings.feature
 */
import "@testing-library/jest-dom/vitest";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSsoHost, renderWithSsoHost } from "../../../testing.tsx";
import { SsoOverviewCard } from "../sso-overview-card.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    view: null as unknown,
    error: null as unknown,
    options: [] as ({ enabled?: boolean } | undefined)[],
  },
}));

vi.mock("../../../behavior/sso-api.ts", () => ({
  ssoApi: {
    ssoSetup: {
      getSetup: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          state.options.push(options);
          return {
            data: state.error ? void 0 : state.view,
            isLoading: false,
            isError: state.error !== null,
            error: state.error,
          };
        },
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
  enterpriseRequired: false,
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
  state.error = null;
  state.options = [];
});

const renderCard = ({ canManage = true } = {}) =>
  renderWithSsoHost(<SsoOverviewCard organizationId="org-1" />, new FakeSsoHost({ canManage }));

const chipTexts = () =>
  screen.getAllByTestId("authentication-domain-chip").map((chip) => chip.textContent);

describe("given an organization with one proved domain and one still waiting", () => {
  beforeEach(() => {
    state.view = {
      ...viewWith(
        connection({
          domainProofs: [
            {
              domain: "acme.com",
              method: "dns-txt",
              qualification: "QUALIFIED",
              proofState: "VERIFIED",
              graceEndsAtMs: null,
              verifiedAtMs: 1,
              verifier: { type: "user", id: "ana" },
            },
          ],
        }),
      ),
      claims: [
        { domain: "acme.com", state: "APPROVED", waitsForReview: false, note: null },
        { domain: "acme.co.uk", state: "CLAIMED", waitsForReview: false, note: null },
      ],
    };
  });

  /** @scenario "Verifying a domain is answerable from here" */
  it("says which domains are proved and which are not, and offers the way", () => {
    renderCard();

    expect(chipTexts()).toEqual(["acme.com · Proved", "acme.co.uk · Not proved yet"]);
    expect(screen.getByRole("link", { name: /Prove a domain/ })).toHaveAttribute(
      "href",
      "/settings/authentication/provider",
    );
  });

  it("offers a reader who may not manage the states but not the way", () => {
    renderCard({ canManage: false });

    expect(chipTexts()).toHaveLength(2);
    expect(screen.queryByTestId("sso-prove-domain")).toBeNull();
  });
});

describe("given a claim on a domain another organization proved", () => {
  it("says a contested claim is with us, and an ordinary one is with them", () => {
    state.view = {
      ...viewWith(null),
      claims: [{ domain: "acme.com", state: "CLAIMED", waitsForReview: true, note: null }],
    };
    renderCard();

    expect(chipTexts()).toEqual(["acme.com · Waiting for review"]);
  });
});

describe("given an organization that has claimed no domain", () => {
  /** @scenario "Verifying a domain is answerable from here" */
  it("says no domain has been claimed rather than showing an empty panel", () => {
    state.view = viewWith(null);
    renderCard();

    expect(screen.getByTestId("domains-empty")).toBeInTheDocument();
    expect(screen.getByTestId("sso-prove-domain")).toBeInTheDocument();
  });
});

describe("given an organization not on an Enterprise plan", () => {
  /** @scenario "The sign-on card says up front that single sign-on needs an Enterprise plan" */
  it("says Enterprise on the card and offers neither control", () => {
    state.view = { ...viewWith(null), enterpriseRequired: true };
    renderCard();

    expect(screen.getByTestId("sso-card-enterprise-gate")).toHaveTextContent(/Enterprise/);
    expect(screen.queryByTestId("sso-prove-domain")).toBeNull();
    expect(screen.queryByTestId("single-sign-on-preview-action")).toBeNull();
  });
});

describe("when the reader may not see single sign-on", () => {
  /** @scenario "Verifying a domain is answerable from here" */
  it("sends no request and says who can tell them", () => {
    renderWithSsoHost(
      <SsoOverviewCard organizationId="org-1" />,
      new FakeSsoHost({ canView: false }),
    );

    expect(state.options.length).toBeGreaterThan(0);
    expect(state.options.every((options) => options?.enabled === false)).toBe(true);
    expect(screen.getByTestId("domains-no-access")).toHaveTextContent(/administrator/i);
    expect(screen.queryByTestId("sso-load-failure")).toBeNull();
  });

  it("asks for the read when the reader holds sso:view", () => {
    state.view = viewWith(null);
    renderCard();

    expect(state.options.every((options) => options?.enabled === true)).toBe(true);
    expect(screen.queryByTestId("domains-no-access")).toBeNull();
  });

  it("says a read that failed out loud", () => {
    state.error = Object.assign(new Error("INTERNAL_SERVER_ERROR"), {
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
    });
    renderCard();

    expect(screen.getByTestId("sso-load-failure")).toBeInTheDocument();
    expect(screen.queryByTestId("domains-no-access")).toBeNull();
  });
});
