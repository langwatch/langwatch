import type {
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

function build({
  byDomain = null,
  active = [],
  policy = POLICY,
  breakGlassAllowed = true,
}: {
  byDomain?: RoutableConnection | null;
  active?: readonly RoutableConnection[];
  policy?: SignInMethodPolicy;
  breakGlassAllowed?: boolean;
} = {}) {
  const records: SignInRoutingRecord[] = [];
  const findConnectionForDomain = vi.fn().mockResolvedValue(byDomain);
  const listActiveConnections = vi.fn().mockResolvedValue(active);
  const service = new SignInRouterService({
    domains: { findConnectionForDomain, listActiveConnections },
    policy: { resolvePolicy: async () => policy },
    breakGlass: { allow: async () => breakGlassAllowed },
    recorder: { decided: (record) => records.push(record) },
  });
  return { service, records, findConnectionForDomain, listActiveConnections };
}

describe("SignInRouterService", () => {
  describe("when an address is submitted", () => {
    it("asks the domain port about the normalized domain only", async () => {
      const { service, findConnectionForDomain, listActiveConnections } =
        build({ byDomain: ACME });

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
      const { service, findConnectionForDomain, listActiveConnections } =
        build({ active: [ACME] });

      const decision = await service.route({ identifier: null });

      expect(listActiveConnections).toHaveBeenCalledTimes(1);
      expect(findConnectionForDomain).not.toHaveBeenCalled();
      expect(decision.reasonCode).toBe("sole_active_connection");
    });
  });

  describe("when the break-glass parameter is used", () => {
    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("answers the local method set without reading the connection store", async () => {
      const { service, findConnectionForDomain, listActiveConnections } =
        build({ active: [ACME] });

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

    /** @scenario "The break-glass path always reaches a local sign-in" */
    it("stops bypassing the redirect once the budget is spent, and locks nobody out", async () => {
      const { service } = build({ active: [ACME], breakGlassAllowed: false });

      const decision = await service.route({
        identifier: null,
        breakGlass: true,
      });

      // Routed like any other request rather than refused: a spent budget must
      // never be a way to make the front door answer nothing at all.
      expect(decision.outcome).toBe("redirect_to_connection");
      expect(decision.reasonCode).toBe("sole_active_connection");
    });
  });
});
