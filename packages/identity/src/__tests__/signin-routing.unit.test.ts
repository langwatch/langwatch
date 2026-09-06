import { describe, expect, it } from "vitest";
import { normalizeIdentifierValue } from "../identifier";
import {
  compareToLegacy,
  type RoutableConnection,
  type RoutingDecision,
  type SignInMethod,
  type SignInMethodPolicy,
  legacyProviderOf,
  routeSignIn,
  routingIdentifierOf,
} from "../signin-routing";

const PASSWORD: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};

const okta: SignInMethod = {
  id: "okta",
  kind: "federated",
  connectionId: "conn_acme",
};

function connection(
  overrides: Partial<RoutableConnection> = {},
): RoutableConnection {
  return {
    connectionId: "conn_acme",
    method: okta,
    state: "ACTIVE",
    configured: true,
    allowsJit: true,
    ...overrides,
  };
}

function policy(
  overrides: Partial<SignInMethodPolicy> = {},
): SignInMethodPolicy {
  return {
    defaultMethods: [PASSWORD],
    localMethods: [PASSWORD],
    federationLicensed: true,
    selfHosted: true,
    ...overrides,
  };
}

function route({
  raw = null,
  breakGlass = false,
  domainConnection = null,
  activeConnections = [],
  methodPolicy = policy(),
}: {
  raw?: string | null;
  breakGlass?: boolean;
  domainConnection?: RoutableConnection | null;
  activeConnections?: readonly RoutableConnection[];
  methodPolicy?: SignInMethodPolicy;
} = {}): RoutingDecision {
  return routeSignIn({
    identifier: raw === null ? null : routingIdentifierOf(raw),
    breakGlass,
    policy: methodPolicy,
    domainConnection,
    activeConnections,
  });
}

describe("the identifier-first sign-in router", () => {
  describe("given a domain that belongs to an ACTIVE connection", () => {
    /** @scenario "An email on an SSO domain routes to that connection's provider" */
    it("redirects to that connection's identity provider", () => {
      const decision = route({
        raw: "Sam.J+news@Acme.com",
        domainConnection: connection(),
      });

      expect(decision).toEqual({
        outcome: "redirect_to_connection",
        connectionId: "conn_acme",
        methodSet: [okta],
        reasonCode: "domain_routed",
      });
    });

    /** @scenario "An email on an SSO domain routes to that connection's provider" */
    it("normalizes the submitted value exactly as an attach does", () => {
      const identifier = routingIdentifierOf("Sam.J+news@Acme.com");

      expect(identifier.normalized).toBe(
        normalizeIdentifierValue("Sam.J+news@Acme.com"),
      );
      // The tag survives the fold, and the DOMAIN is still what routes: a
      // tagged address reaches its organization's connection exactly as the
      // bare one does.
      expect(identifier).toEqual({
        normalized: "sam.j+news@acme.com",
        domain: "acme.com",
      });
    });
  });

  describe("given a domain that belongs to no ACTIVE connection", () => {
    /** @scenario "An email with no domain match offers the uniform method picker" */
    it("offers the instance's default method set", () => {
      const decision = route({ raw: "sam@home.net" });

      expect(decision).toEqual({
        outcome: "method_picker",
        methodSet: [PASSWORD],
        reasonCode: "no_domain_match",
      });
    });

    /** @scenario "The decision never depends on whether an account exists" */
    it("answers a known address and an unknown one with one decision, field for field", () => {
      // The engine takes no user data at all, so "known" and "unknown" are the
      // same call. That is the invariant: there is no branch here that could
      // tell them apart, and none can be added without this test noticing.
      const known = route({ raw: "sam@home.net" });
      const unknown = route({ raw: "nobody-has-ever-signed-up@home.net" });

      expect(known).toEqual(unknown);
      expect(Object.keys(known).sort()).toEqual([
        "methodSet",
        "outcome",
        "reasonCode",
      ]);
      expect(JSON.stringify(known)).not.toContain("sam");
    });
  });

  describe("given a connection that has been suspended", () => {
    /** @scenario "A suspended connection stops routing its domain" */
    it("offers the method picker and names why with a code the screens can render", () => {
      const decision = route({
        raw: "sam@acme.com",
        domainConnection: connection({ state: "SUSPENDED" }),
      });

      expect(decision.outcome).toBe("method_picker");
      expect(decision.connectionId).toBeUndefined();
      expect(decision.reasonCode).toBe("connection_suspended");
    });
  });

  describe("given a self-hosted installation with exactly one ACTIVE connection", () => {
    /** @scenario "A sole ACTIVE connection auto-redirects before any email is asked" */
    it("redirects immediately, with no address asked for", () => {
      const decision = route({ activeConnections: [connection()] });

      expect(decision).toEqual({
        outcome: "redirect_to_connection",
        connectionId: "conn_acme",
        methodSet: [okta],
        reasonCode: "sole_active_connection",
      });
    });

    it("asks for an address instead when a second connection exists", () => {
      const decision = route({
        activeConnections: [
          connection(),
          connection({ connectionId: "conn_other" }),
        ],
      });

      expect(decision.outcome).toBe("method_picker");
      expect(decision.reasonCode).toBe("no_domain_match");
    });

    it("never auto-redirects on cloud, where one org may not claim the door", () => {
      const decision = route({
        activeConnections: [connection()],
        methodPolicy: policy({ selfHosted: false }),
      });

      expect(decision.outcome).toBe("method_picker");
    });

    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("reaches the local method set through the break-glass parameter", () => {
      const decision = route({
        breakGlass: true,
        activeConnections: [connection()],
      });

      expect(decision).toEqual({
        outcome: "method_picker",
        methodSet: [PASSWORD],
        reasonCode: "break_glass",
      });
    });

    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("reaches it even when the submitted address routes to a connection", () => {
      const decision = route({
        raw: "sam@acme.com",
        breakGlass: true,
        domainConnection: connection(),
      });

      expect(decision.outcome).toBe("method_picker");
      expect(decision.reasonCode).toBe("break_glass");
    });
  });

  describe("given a deployment whose license gate denies federation", () => {
    /** @scenario "A never-licensed installation offers no federated method" */
    it("keeps every federated method out of the decision and offers the local set", () => {
      const denied = policy({
        federationLicensed: false,
        defaultMethods: [PASSWORD],
      });

      const withoutEmail = route({
        activeConnections: [connection()],
        methodPolicy: denied,
      });
      const withEmail = route({
        raw: "sam@acme.com",
        domainConnection: connection(),
        methodPolicy: denied,
      });

      for (const decision of [withoutEmail, withEmail]) {
        expect(decision.outcome).toBe("method_picker");
        expect(decision.methodSet).toEqual([PASSWORD]);
        expect(
          decision.methodSet.some((method) => method.kind === "federated"),
        ).toBe(false);
      }
      expect(withEmail.reasonCode).toBe("method_not_licensed");
    });
  });

  describe("given a connection whose method this build never mounted", () => {
    it("falls back to the local set and says which of the two failed", () => {
      const decision = route({
        raw: "sam@acme.com",
        domainConnection: connection({ configured: false }),
      });

      expect(decision.methodSet).toEqual([PASSWORD]);
      expect(decision.reasonCode).toBe("method_not_configured");
    });
  });

  describe("given a submitted value that is not email-shaped", () => {
    it("treats it as no domain at all rather than routing on a fragment", () => {
      const decision = route({
        raw: "sam",
        domainConnection: connection(),
      });

      expect(decision.reasonCode).toBe("no_domain_match");
    });
  });

  describe("when a decision is projected onto the legacy path's one answer", () => {
    it("reads a redirect as the provider the legacy page redirects to", () => {
      const decision = route({
        raw: "sam@acme.com",
        domainConnection: connection(),
      });

      expect(legacyProviderOf(decision)).toBe("okta");
    });

    it("reads a local picker as email mode", () => {
      expect(legacyProviderOf(route({ raw: "sam@home.net" }))).toBe("email");
    });

    it("reads a sole-federated default set as that provider", () => {
      const decision = route({
        raw: "sam@home.net",
        methodPolicy: policy({ defaultMethods: [okta] }),
      });

      expect(legacyProviderOf(decision)).toBe("okta");
    });

    it("reads a multi-method picker as email mode, since no legacy page had one", () => {
      const decision = route({
        raw: "sam@home.net",
        methodPolicy: policy({ defaultMethods: [PASSWORD, okta] }),
      });

      expect(legacyProviderOf(decision)).toBe("email");
    });
  });

  describe("when shadow mode compares a decision against the legacy outcome", () => {
    it("agrees when both answer the same provider", () => {
      const decision = route({
        raw: "sam@acme.com",
        domainConnection: connection(),
      });

      expect(
        compareToLegacy({ decision, legacyProvider: "okta" }),
      ).toEqual({
        matches: true,
        routerProvider: "okta",
        legacyProvider: "okta",
        reasonCode: "domain_routed",
      });
    });

    it("carries both answers and the reason code when they disagree", () => {
      const decision = route({ raw: "sam@home.net" });

      expect(
        compareToLegacy({ decision, legacyProvider: "okta" }),
      ).toEqual({
        matches: false,
        routerProvider: "email",
        legacyProvider: "okta",
        reasonCode: "no_domain_match",
      });
    });
  });
});
