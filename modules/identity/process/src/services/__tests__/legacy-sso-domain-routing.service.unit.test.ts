import type { RoutableConnection, SignInMethod } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { MemoryLegacySsoOrganizationRepository } from "../../repositories/memory/memory.legacy-sso-organization.repository.ts";
import { LegacySsoDomainRoutingService } from "../legacy-sso-domain-routing.service.ts";
import { SignInRouterService } from "../signin-router.service.ts";

const PASSWORD: SignInMethod = { id: "password", kind: "password", connectionId: null };
const AUTH0: SignInMethod = { id: "auth0", kind: "federated", connectionId: null };

const PROJECTED: RoutableConnection = {
  connectionId: "conn_acme",
  method: { id: "okta", kind: "federated", connectionId: "conn_acme" },
  state: "ACTIVE",
  configured: true,
  allowsJit: true,
};

function build({ projected }: { projected: RoutableConnection | null }) {
  const legacy = LegacySsoDomainRoutingService.create({
    organizations: MemoryLegacySsoOrganizationRepository.create([
      { id: "org_acme", name: "Acme", ssoDomain: "acme.com", ssoProvider: "waad|acme" },
    ]),
    mountedMethods: async () => [AUTH0],
  });
  return SignInRouterService.create({
    domains: {
      findConnectionsForDomain: async () => (projected ? [projected] : []),
      findActiveConnections: async () => [],
    },
    legacy,
    policy: {
      resolvePolicy: async () => ({
        defaultMethods: [PASSWORD],
        localMethods: [PASSWORD],
        federationLicensed: true,
        selfHosted: false,
      }),
    },
    breakGlass: { allow: async () => true },
    accounts: { findAccountMethods: async () => null },
    recorder: { decided: () => undefined },
  });
}

describe("LegacySsoDomainRoutingService behind the sign-in router", () => {
  describe("when no projected connection holds the domain", () => {
    it("routes through the organization's legacy columns", async () => {
      const decision = await build({ projected: null }).route({ identifier: "sam@acme.com" });

      expect(decision).toMatchObject({
        outcome: "redirect_to_connection",
        connectionId: "org:org_acme",
        reasonCode: "domain_routed",
      });
    });
  });

  describe("when a projected connection holds the domain", () => {
    it("routes through the projected connection, not the legacy columns", async () => {
      const decision = await build({ projected: PROJECTED }).route({
        identifier: "sam@acme.com",
      });

      expect(decision).toMatchObject({
        outcome: "redirect_to_connection",
        connectionId: "conn_acme",
      });
    });
  });

  describe("when the domain belongs to no organization", () => {
    it("finds no legacy connection", async () => {
      const legacy = LegacySsoDomainRoutingService.create({
        organizations: MemoryLegacySsoOrganizationRepository.create(),
        mountedMethods: async () => [AUTH0],
      });

      expect(await legacy.findLegacyConnectionForDomain({ domain: "other.com" })).toBeNull();
    });
  });
});
