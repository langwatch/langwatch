import type { SignInMethod } from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { LegacySsoDomainRoutingRepository } from "../legacy-sso-domain.prisma.repository";

const AUTH0: SignInMethod = {
  id: "auth0",
  kind: "federated",
  connectionId: null,
};

function build({
  organization = null,
  instanceMethod = AUTH0,
}: {
  organization?: { id: string; ssoProvider: string | null } | null;
  instanceMethod?: SignInMethod | null;
} = {}) {
  const findUnique = vi.fn().mockResolvedValue(organization);
  const prisma = { organization: { findUnique } } as unknown as PrismaClient;
  return {
    findUnique,
    repository: new LegacySsoDomainRoutingRepository(
      prisma,
      async () => instanceMethod,
    ),
  };
}

describe("the legacy ssoDomain routing lookup", () => {
  describe("when a domain belongs to an organization with an SSO provider", () => {
    it("answers a connection routing to that provider", async () => {
      const { repository, findUnique } = build({
        organization: { id: "org_acme", ssoProvider: "auth0" },
      });

      const connection = await repository.findConnectionForDomain({
        domain: "acme.com",
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { ssoDomain: "acme.com" },
        select: { id: true, ssoProvider: true },
      });
      expect(connection).toEqual({
        connectionId: "org:org_acme",
        method: {
          id: "auth0",
          kind: "federated",
          connectionId: "org:org_acme",
        },
        state: "ACTIVE",
        configured: true,
        allowsJit: true,
      });
    });

    it("reports it unconfigured when the deployment mounts a different provider", async () => {
      const { repository } = build({
        organization: { id: "org_acme", ssoProvider: "okta" },
        instanceMethod: AUTH0,
      });

      const connection = await repository.findConnectionForDomain({
        domain: "acme.com",
      });

      expect(connection?.configured).toBe(false);
    });
  });

  describe("when a domain belongs to nobody", () => {
    it("answers null, the same null an unconfigured domain gets", async () => {
      const { repository } = build();

      await expect(
        repository.findConnectionForDomain({ domain: "home.net" }),
      ).resolves.toBeNull();
    });

    it("answers null for an organization that names no provider", async () => {
      const { repository } = build({
        organization: { id: "org_acme", ssoProvider: null },
      });

      await expect(
        repository.findConnectionForDomain({ domain: "acme.com" }),
      ).resolves.toBeNull();
    });
  });

  describe("when the instance is asked what it could auto-redirect to", () => {
    it("presents the configured provider as its one connection", async () => {
      const { repository } = build();

      await expect(repository.listActiveConnections()).resolves.toEqual([
        {
          connectionId: "env:auth0",
          method: { id: "auth0", kind: "federated", connectionId: "env:auth0" },
          state: "ACTIVE",
          configured: true,
          allowsJit: true,
        },
      ]);
    });

    it("presents none in email mode, so nothing auto-redirects", async () => {
      const { repository } = build({ instanceMethod: null });

      await expect(repository.listActiveConnections()).resolves.toEqual([]);
    });
  });
});
