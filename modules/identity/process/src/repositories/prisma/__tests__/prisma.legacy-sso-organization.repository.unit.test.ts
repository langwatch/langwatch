import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { PrismaLegacySsoOrganizationRepository } from "../prisma.legacy-sso-organization.repository.ts";

function repositoryOver(findUniqueImpl: () => Promise<unknown>) {
  const findUnique = vi.fn(findUniqueImpl);
  const prisma = { organization: { findUnique } } as unknown as PrismaClient;

  return { findUnique, repository: PrismaLegacySsoOrganizationRepository.create(prisma) };
}

describe("PrismaLegacySsoOrganizationRepository", () => {
  describe("getLegacySso()", () => {
    it("answers the domain and provider when both are set", async () => {
      const { repository } = repositoryOver(async () => ({
        ssoDomain: "acme.example",
        ssoProvider: "okta",
      }));

      const result = await repository.getLegacySso({ organizationId: "org-1" });

      expect(result).toEqual({ ssoDomain: "acme.example", ssoProvider: "okta" });
    });

    it.each([
      ["a domain with no provider", { ssoDomain: "acme.example", ssoProvider: null }],
      ["a provider with no domain", { ssoDomain: null, ssoProvider: "okta" }],
      ["neither", { ssoDomain: null, ssoProvider: null }],
      ["no organization at all", null],
    ])(
      "refuses %s as not found — half a configuration is not something to grandfather",
      async (_case, row) => {
        const { repository } = repositoryOver(async () => row);

        await expect(repository.getLegacySso({ organizationId: "org-1" })).rejects.toMatchObject({
          code: "sso_connection_not_found",
        });
      },
    );
  });

  describe("findByDomain()", () => {
    it("answers the organization registered to the domain", async () => {
      const { repository, findUnique } = repositoryOver(async () => ({
        id: "org-1",
        name: "Acme",
        ssoProvider: "okta",
      }));

      const result = await repository.findByDomain({ domain: "acme.example" });

      expect(result).toEqual({ id: "org-1", name: "Acme", ssoProvider: "okta" });
      expect(findUnique).toHaveBeenCalledWith({
        where: { ssoDomain: "acme.example" },
        select: { id: true, name: true, ssoProvider: true },
      });
    });

    it("answers null when no organization is registered to the domain", async () => {
      const { repository } = repositoryOver(async () => null);

      const result = await repository.findByDomain({ domain: "nobody.example" });

      expect(result).toBeNull();
    });
  });
});
