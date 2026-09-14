import type { SignInMethod, SignInMethodPolicy } from "@langwatch/identity";
import {
  type SignInDomainRoutingPort,
  SignInRouterService,
} from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { LegacySsoDomainRoutingRepository } from "../repositories/legacy-sso-domain.prisma.repository";
import { ConnectionFirstDomainRoutingRepository } from "../repositories/sso-routing-connection-first.repository";

/**
 * Does a customer who signs in through their identity provider TODAY still
 * get sent there, now that the identifier-first screen is the only door?
 *
 * Every such organization is on the legacy `Organization.ssoDomain` /
 * `ssoProvider` columns and has registered no connection, so this wires the
 * shape they are actually in: the real router service, the real decision
 * engine, the real connection-first repository with an EMPTY projection, and
 * the real legacy repository over a stubbed Prisma. Only the database is
 * fake — every decision in between is the one production makes.
 *
 * The neighbouring suites stop short of this. `sso-routing-connection-first`
 * proves which SIDE answered, and `sso-idp-termination` proves a connection
 * counts as `configured` — neither asserts the decision the person meets,
 * which is the only thing an administrator is asking about.
 *
 * Spec: specs/identity/sso-idp-termination.feature
 */

const MOUNTED: SignInMethod = {
  id: "auth0",
  kind: "federated",
  connectionId: null,
};

const PASSWORD: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};

/** The projection every current customer has: no connection, for any domain. */
const noConnectionRegistered: SignInDomainRoutingPort = {
  findConnectionForDomain: async () => null,
  listActiveConnections: async () => [],
};

function routerFor({
  ssoDomain,
  ssoProvider,
}: {
  ssoDomain: string;
  ssoProvider: string | null;
}) {
  const findUnique = vi.fn(
    async ({ where }: { where: { ssoDomain: string } }) =>
      where.ssoDomain === ssoDomain ? { id: "org_acme", ssoProvider } : null,
  );
  const prisma = {
    organization: { findUnique },
  } as unknown as PrismaClient;

  const policy: SignInMethodPolicy = {
    defaultMethods: [PASSWORD],
    localMethods: [PASSWORD],
    federationLicensed: true,
    selfHosted: false,
  };

  return {
    findUnique,
    service: new SignInRouterService({
      domains: new ConnectionFirstDomainRoutingRepository({
        legacy: new LegacySsoDomainRoutingRepository(
          prisma,
          async () => MOUNTED,
        ),
        connections: noConnectionRegistered,
      }),
      policy: { resolvePolicy: async () => policy },
      breakGlass: { allow: async () => false },
      accounts: { findAccountMethods: async () => null },
    }),
  };
}

describe("given an organization that signs in through this deployment's provider today", () => {
  describe("when one of its people submits their work email", () => {
    /** @scenario An organization signing in through the mounted provider today is still sent to it */
    it("sends them to that provider", async () => {
      const { service } = routerFor({
        ssoDomain: "acme.com",
        ssoProvider: "auth0",
      });

      const decision = await service.route({ identifier: "sam@acme.com" });

      expect(decision.outcome).toBe("redirect_to_connection");
      expect(decision.methodSet.map((method) => method.id)).toEqual(["auth0"]);
      expect(decision.reasonCode).toBe("domain_routed");
    });

    /** @scenario An organization signing in through the mounted provider today is still sent to it */
    it("never offers a password on the way", async () => {
      // The redirect comes first, so there is nothing to type into wrongly —
      // and a password in this method set would be a box in front of an
      // account whose credential lives at the provider.
      const { service } = routerFor({
        ssoDomain: "acme.com",
        ssoProvider: "auth0",
      });

      const decision = await service.route({ identifier: "sam@acme.com" });

      expect(decision.methodSet.some((one) => one.kind === "password")).toBe(
        false,
      );
    });

    /** @scenario Their address routes however they happened to type it */
    it.each([
      ["Sam.J@Acme.com"],
      ["sam+news@acme.com"],
      ["  sam@ACME.COM  "],
    ])("routes %s the same way", async (typed) => {
      const { service, findUnique } = routerFor({
        ssoDomain: "acme.com",
        ssoProvider: "auth0",
      });

      const decision = await service.route({ identifier: typed });

      expect(decision.outcome).toBe("redirect_to_connection");
      // The domain reached Postgres already normalized, which is what makes
      // the unique lookup on `ssoDomain` hit for an address typed any way.
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ssoDomain: "acme.com" } }),
      );
    });
  });
});

describe("given an organization naming a provider this deployment never mounted", () => {
  describe("when one of its people submits their work email", () => {
    /** @scenario An organization naming a provider this deployment does not mount is not sent nowhere */
    it("offers the local methods rather than a door that cannot open", async () => {
      const { service } = routerFor({
        ssoDomain: "acme.com",
        ssoProvider: "okta",
      });

      const decision = await service.route({ identifier: "sam@acme.com" });

      expect(decision.outcome).not.toBe("redirect_to_connection");
      expect(decision.reasonCode).toBe("method_not_configured");
      expect(decision.methodSet.map((one) => one.id)).toEqual(["password"]);
    });
  });
});

describe("given an organization with no SSO configured at all", () => {
  describe("when somebody submits an address on its domain", () => {
    it("leaves the domain to the rest of the router", async () => {
      const { service } = routerFor({
        ssoDomain: "acme.com",
        ssoProvider: null,
      });

      const decision = await service.route({ identifier: "sam@acme.com" });

      expect(decision.outcome).not.toBe("redirect_to_connection");
    });
  });
});
