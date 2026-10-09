import type {
  AccountSignInMethods,
  RoutableConnection,
  SignInMethod,
  SignInMethodPolicy,
} from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import {
  type SignInRoutingRecord,
  SignInRouterService,
} from "../signin-router.service";

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

const ACME: RoutableConnection = {
  connectionId: "conn_acme",
  method: okta,
  state: "ACTIVE",
  configured: true,
  allowsJit: true,
};

const POLICY: SignInMethodPolicy = {
  defaultMethods: [PASSWORD],
  localMethods: [PASSWORD],
  federationLicensed: true,
  selfHosted: true,
};

/** An account holding a password and nothing else — the ordinary case. */
const PASSWORD_ACCOUNT: AccountSignInMethods = {
  hasPassword: true,
  hasPasskey: false,
  providerIds: [],
  connectionIds: [],
};

function build({
  byDomain = null,
  legacyByDomain = null,
  projectedByDomain = byDomain,
  active = [],
  legacyActive = [],
  projectedActive = active,
  policy = POLICY,
  breakGlassAllowed = true,
  account = PASSWORD_ACCOUNT,
}: {
  byDomain?: RoutableConnection | null;
  legacyByDomain?: RoutableConnection | null;
  projectedByDomain?: RoutableConnection | null;
  active?: readonly RoutableConnection[];
  legacyActive?: readonly RoutableConnection[];
  projectedActive?: readonly RoutableConnection[];
  policy?: SignInMethodPolicy;
  breakGlassAllowed?: boolean;
  /** What the address's account holds; null for an address nobody holds. */
  account?: AccountSignInMethods | null;
} = {}) {
  const records: SignInRoutingRecord[] = [];
  const findConnectionForDomain = vi.fn().mockResolvedValue(projectedByDomain);
  const findLegacyConnectionForDomain = vi
    .fn()
    .mockResolvedValue(legacyByDomain);
  const listActiveConnections = vi.fn().mockResolvedValue(projectedActive);
  const listLegacyActiveConnections = vi.fn().mockResolvedValue(legacyActive);
  const findAccountMethods = vi.fn().mockResolvedValue(account);
  const service = new SignInRouterService({
    domains: {
      legacy: {
        findConnectionForDomain: findLegacyConnectionForDomain,
        listActiveConnections: listLegacyActiveConnections,
      },
      connections: { findConnectionForDomain, listActiveConnections },
    },
    policy: { resolvePolicy: async () => policy },
    breakGlass: { allow: async () => breakGlassAllowed },
    accounts: { findAccountMethods },
    recorder: { decided: (record) => records.push(record) },
  });
  return {
    service,
    records,
    findConnectionForDomain,
    findLegacyConnectionForDomain,
    listActiveConnections,
    listLegacyActiveConnections,
    findAccountMethods,
  };
}

describe("SignInRouterService", () => {
  describe("when an address is submitted", () => {
    /** @scenario "A live connection decides the domains it proved" */
    it("asks the domain port about the normalized domain only", async () => {
      const { service, findConnectionForDomain, listActiveConnections } = build(
        { byDomain: ACME },
      );

      const decision = await service.route({
        identifier: "Sam.J+news@Acme.com",
      });

      expect(findConnectionForDomain).toHaveBeenCalledWith({
        domain: "acme.com",
      });
      expect(listActiveConnections).not.toHaveBeenCalled();
      expect(decision.reasonCode).toBe("domain_routed");
    });

    /** @scenario "Every routing decision is logged with its reason" */
    it("records the decision and its reason code", async () => {
      const { service, records } = build({ byDomain: ACME });

      await service.route({ identifier: "sam@acme.com" });

      expect(records).toEqual([
        {
          outcome: "redirect_to_connection",
          reasonCode: "domain_routed",
          connectionId: "conn_acme",
          domain: "acme.com",
          breakGlass: false,
          breakGlassRateLimited: false,
          breakGlassIdentifier: null,
        },
      ]);
    });

    /** @scenario "Every routing decision is logged with its reason" */
    it("records the domain and never the local part of the address", async () => {
      const { service, records } = build();

      await service.route({ identifier: "sam.j+news@home.net" });

      const [record] = records;
      expect(record?.domain).toBe("home.net");
      expect(JSON.stringify(record)).not.toContain("sam");
    });
  });

  describe("when no address has been asked for yet", () => {
    it("asks the domain port for the connections it could auto-redirect to", async () => {
      const {
        service,
        findConnectionForDomain,
        listActiveConnections,
        listLegacyActiveConnections,
      } = build({ active: [ACME] });

      const decision = await service.route({ identifier: null });

      expect(listActiveConnections).toHaveBeenCalledTimes(1);
      expect(listLegacyActiveConnections).toHaveBeenCalledTimes(1);
      expect(findConnectionForDomain).not.toHaveBeenCalled();
      expect(decision.reasonCode).toBe("sole_active_connection");
    });
  });

  describe("when the projected connection does not decide the domain", () => {
    it("falls back to the legacy domain lookup for unfinished connections", async () => {
      const unfinished: RoutableConnection = {
        ...ACME,
        state: "INACTIVE",
      };
      const { service, findLegacyConnectionForDomain } = build({
        projectedByDomain: unfinished,
        legacyByDomain: ACME,
      });

      const decision = await service.route({ identifier: "sam@acme.com" });

      expect(decision.reasonCode).toBe("domain_routed");
      expect(findLegacyConnectionForDomain).toHaveBeenCalledWith({
        domain: "acme.com",
      });
    });

    /** @scenario "A domain no connection answers for is still decided by the legacy columns" */
    it("uses the legacy domain when no connection is projected", async () => {
      const { service, findLegacyConnectionForDomain } = build({
        projectedByDomain: null,
        legacyByDomain: ACME,
      });

      const decision = await service.route({ identifier: "sam@acme.com" });

      expect(decision.reasonCode).toBe("domain_routed");
      expect(findLegacyConnectionForDomain).toHaveBeenCalledWith({
        domain: "acme.com",
      });
    });
  });

  describe("when no address has been asked for yet", () => {
    it("uses the legacy list only when the projected list is empty", async () => {
      const { service } = build({ active: [], legacyActive: [ACME] });

      const decision = await service.route({ identifier: null });

      expect(decision.reasonCode).toBe("sole_active_connection");
      expect(decision.connectionId).toBe("conn_acme");
    });

    it("uses the projected list as the selected replacement", async () => {
      const legacy: RoutableConnection = {
        ...ACME,
        connectionId: "legacy",
      };
      const projected: RoutableConnection = {
        ...ACME,
        connectionId: "replacement",
      };
      const { service } = build({
        active: [projected],
        legacyActive: [legacy],
      });

      const decision = await service.route({ identifier: null });

      expect(decision.connectionId).toBe("replacement");
    });

    it("does not implicitly roll back a suspended projected connection", async () => {
      const suspended: RoutableConnection = {
        ...ACME,
        state: "SUSPENDED",
      };
      const legacy: RoutableConnection = {
        ...ACME,
        connectionId: "legacy",
      };
      const { service } = build({
        active: [suspended],
        legacyActive: [legacy],
      });

      const decision = await service.route({ identifier: null });

      expect(decision.connectionId).toBe("conn_acme");
    });
  });

  describe("when the break-glass parameter is used", () => {
    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("answers the local method set without reading the connection store", async () => {
      const { service, findConnectionForDomain, listActiveConnections } = build(
        { active: [ACME] },
      );

      const decision = await service.route({
        identifier: null,
        breakGlass: true,
      });

      expect(decision.outcome).toBe("method_picker");
      expect(decision.methodSet).toEqual([PASSWORD]);
      expect(findConnectionForDomain).not.toHaveBeenCalled();
      expect(listActiveConnections).not.toHaveBeenCalled();
    });

    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("audits the request, granted or not", async () => {
      const granted = build({ active: [ACME] });
      await granted.service.route({ identifier: null, breakGlass: true });

      const spent = build({ active: [ACME], breakGlassAllowed: false });
      await spent.service.route({ identifier: null, breakGlass: true });

      expect(granted.records[0]).toMatchObject({
        reasonCode: "break_glass",
        breakGlass: true,
        breakGlassRateLimited: false,
      });
      expect(spent.records[0]).toMatchObject({
        breakGlass: true,
        breakGlassRateLimited: true,
      });
    });

    /** @scenario "The local sign-in path is recorded and rate limited" */
    it("records who walked through the local door, and refuses repeats the way this installation does", async () => {
      const granted = build({ active: [ACME] });
      await granted.service.route({
        identifier: "sam@acme.com",
        breakGlass: true,
      });

      // WHO used it, not only that it was used. The deliberate exception to
      // the local-part rule next door: a granted break-glass is rare and
      // bypasses the identity provider the organization chose, so an audit
      // record that cannot name the person is not one.
      expect(granted.records[0]).toMatchObject({
        breakGlass: true,
        breakGlassRateLimited: false,
        breakGlassIdentifier: "sam@acme.com",
      });

      // Repeated attempts are refused the way this installation refuses
      // repeated sign-ins: the budget is spent, the parameter stops
      // bypassing the redirect, and the refusal is recorded as one.
      const spent = build({ active: [ACME], breakGlassAllowed: false });
      const decision = await spent.service.route({
        identifier: "sam@acme.com",
        breakGlass: true,
      });
      expect(spent.records[0]).toMatchObject({
        breakGlass: true,
        breakGlassRateLimited: true,
      });
      expect(decision.reasonCode).not.toBe("break_glass");

      // And a refused one attributes nothing: it routed like any other
      // request, so there is nothing exceptional to name a person for.
      expect(spent.records[0]?.breakGlassIdentifier).toBeNull();
    });

    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("stops bypassing the redirect once the budget is spent, and locks nobody out", async () => {
      const { service } = build({ active: [ACME], breakGlassAllowed: false });

      const decision = await service.route({
        identifier: null,
        breakGlass: true,
      });

      // Routed like any other request rather than refused: a spent budget must
      // never be a way to make the auth screens answer nothing at all.
      expect(decision.outcome).toBe("redirect_to_connection");
      expect(decision.reasonCode).toBe("sole_active_connection");
    });
  });

  describe("when the address's account is what decides", () => {
    /** @scenario "An address with no account carries on as a sign-up" */
    it("routes to sign-up for an address the lookup does not know", async () => {
      const { service, findAccountMethods } = build({ account: null });

      const decision = await service.route({ identifier: "nobody@home.net" });

      expect(decision.outcome).toBe("route_to_signup");
      expect(findAccountMethods).toHaveBeenCalledWith({
        // Normalized before it is looked up, byte-identical to attach-time:
        // an address that reaches an account when typed one way must reach it
        // typed the other.
        normalizedValue: "nobody@home.net",
      });
    });

    /** @scenario "A connected domain routes before the account is consulted" */
    it("never asks about the account when the domain already routes", async () => {
      const { service, findAccountMethods } = build({ byDomain: ACME });

      const decision = await service.route({ identifier: "sam@acme.com" });

      expect(decision.outcome).toBe("redirect_to_connection");
      // The hot path stays at one Postgres read on the deployments that route
      // the most sign-ins, and just-in-time provisioning keeps working.
      expect(findAccountMethods).not.toHaveBeenCalled();
    });

    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("reads nothing at all on a granted break-glass", async () => {
      const { service, findAccountMethods } = build();

      await service.route({ identifier: "sam@acme.com", breakGlass: true });

      // The door exists for the days the stores are the broken thing, so it
      // depends on none of them.
      expect(findAccountMethods).not.toHaveBeenCalled();
    });

    it("asks nothing when no address was submitted", async () => {
      const { service, findAccountMethods } = build();

      await service.route({ identifier: null });

      expect(findAccountMethods).not.toHaveBeenCalled();
    });

    /**
     * The routing record is written on every attempt, and the revision that
     * made this router existence-aware must not turn that record into a list
     * of who has an account. It carries the DOMAIN, as it always did.
     */
    /** @scenario "An address with no account carries on as a sign-up" */
    it("records the domain and the outcome, never the address", async () => {
      const { service, records } = build({ account: null });

      await service.route({ identifier: "nobody@home.net" });

      expect(records[0]).toMatchObject({
        outcome: "route_to_signup",
        reasonCode: "identifier_unknown",
        domain: "home.net",
        breakGlassIdentifier: null,
      });
      expect(JSON.stringify(records[0])).not.toContain("nobody@");
    });
  });
});
