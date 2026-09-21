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
}: {
  connectionId: string;
  organizationId: string;
  providerId: string;
  state: SsoConnectionState["state"];
  createdAtMs: number;
}): SsoConnectionState {
  const empty = emptySsoConnection({ connectionId });
  return {
    ...empty,
    organizationId,
    state,
    createdAtMs,
    idpMetadata: { ...empty.idpMetadata, providerId },
  };
}

function serviceOver(states: SsoConnectionState[]) {
  class StubReads extends SsoConnectionReadRepository {
    async tryFindConnection(): Promise<null> {
      return null;
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
    it("answers the id, the word an administrator reads, and the state", async () => {
      const service = serviceOver([
        connection({
          connectionId: "ssoc_acme",
          organizationId: ACME,
          providerId: "okta",
          state: "ACTIVE",
          createdAtMs: 2,
        }),
      ]);

      await expect(service.findForOrganization({ organizationId: ACME })).resolves.toEqual([
        { connectionId: "ssoc_acme", displayName: "okta", state: "ACTIVE" },
      ]);
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
