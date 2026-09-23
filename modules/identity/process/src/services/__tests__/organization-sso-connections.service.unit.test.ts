/**
 * @vitest-environment node
 * A peer module asks identity for an organization's connections rather than
 * querying the rows identity owns.
 * Corresponds to specs/identity/sso-connection-lifecycle.feature.
 */
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import { OrganizationSsoConnectionsService } from "../organization-sso-connections.service.ts";

const ACME = "org_acme";

function connection({
  connectionId,
  organizationId,
  providerId,
  state,
  createdAtMs,
  verifiedDomains = [],
  replacesConnectionId = null,
  migrationPhase = null,
}: {
  connectionId: string;
  organizationId: string;
  providerId: string;
  state: SsoConnectionState["state"];
  createdAtMs: number;
  verifiedDomains?: string[];
  replacesConnectionId?: string | null;
  migrationPhase?: SsoConnectionState["migrationPhase"];
}): SsoConnectionState {
  const empty = emptySsoConnection({ connectionId });
  return {
    ...empty,
    organizationId,
    state,
    createdAtMs,
    verifiedDomains,
    replacesConnectionId,
    migrationPhase,
    idpMetadata: { ...empty.idpMetadata, providerId },
  };
}

function serviceOver(states: SsoConnectionState[]) {
  class StubReads extends SsoConnectionReadRepository {
    async tryFindConnection({
      connectionId,
    }: {
      connectionId: string;
    }): Promise<SsoConnectionState | null> {
      return states.find((state) => state.connectionId === connectionId) ?? null;
    }
    async tryFindDomainOwner(): Promise<null> {
      return null;
    }
    async findForOrganization({
      organizationId,
    }: {
      organizationId: string;
    }): Promise<SsoConnectionState[]> {
      return states.filter((state) => state.organizationId === organizationId);
    }
  }
  return OrganizationSsoConnectionsService.create({ connections: new StubReads() });
}

describe("given a peer module asking which connections an organization holds", () => {
  describe("when the organization has registered some", () => {
    it("answers the id, the word an administrator reads, the domains it routes, and the state", async () => {
      const service = serviceOver([
        connection({
          connectionId: "ssoc_acme",
          organizationId: ACME,
          providerId: "okta",
          state: "ACTIVE",
          createdAtMs: 2,
          verifiedDomains: ["acme.com"],
        }),
      ]);

      await expect(service.findForOrganization({ organizationId: ACME })).resolves.toEqual([
        {
          connectionId: "ssoc_acme",
          displayName: "okta",
          providerId: "okta",
          verifiedDomains: ["acme.com"],
          type: "oidc",
          state: "ACTIVE",
          replacesConnectionId: null,
          migrationPhase: null,
        },
      ]);
    });

    it("answers which connection a replacement replaces, and where its cutover stands", async () => {
      const service = serviceOver([
        connection({
          connectionId: "ssoc_direct",
          organizationId: ACME,
          providerId: "okta",
          state: "ACTIVE",
          createdAtMs: 2,
          replacesConnectionId: "ssoc_legacy",
          migrationPhase: "FINALIZING",
        }),
      ]);

      const [replacement] = await service.findForOrganization({ organizationId: ACME });

      expect(replacement).toMatchObject({
        connectionId: "ssoc_direct",
        replacesConnectionId: "ssoc_legacy",
        migrationPhase: "FINALIZING",
      });
    });

    it("never carries another organization's connection", async () => {
      const service = serviceOver([
        connection({
          connectionId: "ssoc_globex",
          organizationId: "org_globex",
          providerId: "entra",
          state: "ACTIVE",
          createdAtMs: 1,
        }),
      ]);

      await expect(service.findForOrganization({ organizationId: ACME })).resolves.toEqual([]);
    });
  });

  describe("when the organization has registered none", () => {
    it("answers an empty list, not an absence", async () => {
      const service = serviceOver([]);

      await expect(service.findForOrganization({ organizationId: ACME })).resolves.toEqual([]);
    });
  });
});

describe("given a peer asking what one of the organization's connections speaks to", () => {
  const acme = connection({
    connectionId: "ssoc_acme",
    organizationId: ACME,
    providerId: "waad|acme",
    state: "ACTIVE",
    createdAtMs: 2,
  });

  it("answers the provider the rows that peer owns were stamped with", async () => {
    const service = serviceOver([acme]);

    await expect(
      service.getProvider({ organizationId: ACME, connectionId: "ssoc_acme" }),
    ).resolves.toEqual({ connectionId: "ssoc_acme", providerId: "waad|acme" });
  });

  it("refuses a connection that is another organization's", async () => {
    const service = serviceOver([{ ...acme, organizationId: "org_globex" }]);

    await expect(
      service.getProvider({ organizationId: ACME, connectionId: "ssoc_acme" }),
    ).rejects.toMatchObject({ code: "sso_connection_not_found" });
  });

  it("refuses a connection nobody registered", async () => {
    const service = serviceOver([]);

    await expect(
      service.getProvider({ organizationId: ACME, connectionId: "ssoc_gone" }),
    ).rejects.toMatchObject({ code: "sso_connection_not_found" });
  });
});
