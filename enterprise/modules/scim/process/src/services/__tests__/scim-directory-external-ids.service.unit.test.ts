// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import { ScimDirectoryExternalIdsService } from "../scim-directory-external-ids.service.ts";

function connection(connectionId: string): OrganizationSsoConnection {
  return {
    connectionId,
    displayName: "okta",
    providerId: "okta",
    verifiedDomains: ["acme.com"],
    type: "oidc",
    state: "ACTIVE",
    replacesConnectionId: null,
    migrationPhase: null,
  };
}

function build(held: OrganizationSsoConnection[]) {
  const identities = MemoryScimRepository.create();
  const service = ScimDirectoryExternalIdsService.create({
    connections: { findHeldConnections: () => Promise.resolve(held) },
    identities,
  });
  return { identities, service };
}

describe("ScimDirectoryExternalIdsService", () => {
  describe("given an organization holding two connections", () => {
    it("answers each connection's identifiers and none from another organization's", async () => {
      const { identities, service } = build([connection("okta"), connection("entra")]);
      await identities.rememberDirectoryIdentity({
        connectionId: "okta",
        externalId: "00u1",
        userId: "ada",
      });
      await identities.rememberDirectoryIdentity({
        connectionId: "entra",
        externalId: "e-7",
        userId: "grace",
      });
      await identities.rememberDirectoryIdentity({
        connectionId: "elsewhere",
        externalId: "x-1",
        userId: "mallory",
      });

      const found = await service.findForOrganization({ organizationId: "acme" });

      expect(found).toEqual(
        expect.arrayContaining([
          { userId: "ada", externalId: "00u1" },
          { userId: "grace", externalId: "e-7" },
        ]),
      );
      expect(found).toHaveLength(2);
    });
  });

  describe("given an organization with no directory connection", () => {
    it("answers no identifiers", async () => {
      const { identities, service } = build([]);
      await identities.rememberDirectoryIdentity({
        connectionId: "okta",
        externalId: "00u1",
        userId: "ada",
      });

      await expect(service.findForOrganization({ organizationId: "acme" })).resolves.toEqual([]);
    });
  });
});
