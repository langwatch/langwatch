/**
 * @vitest-environment node
 * What the sign-in door may fetch a discovery document from is what the
 * customers of this installation registered, and identity is who holds it.
 * Corresponds to specs/identity/sso-connection-lifecycle.feature.
 */
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import { SsoIssuerDirectoryService } from "../sso-issuer-directory.service.ts";

function connection({
  connectionId,
  issuer,
}: {
  connectionId: string;
  issuer: string | null;
}): SsoConnectionState {
  const empty = emptySsoConnection({ connectionId });
  return {
    ...empty,
    organizationId: "org_acme",
    state: "ACTIVE",
    idpMetadata: { ...empty.idpMetadata, providerId: connectionId, issuer },
  };
}

function directoryOver({
  states,
  owners = {},
}: {
  states: SsoConnectionState[];
  owners?: Record<string, string>;
}) {
  class StubReads extends SsoConnectionReadRepository {
    async tryFindConnection({
      connectionId,
    }: {
      connectionId: string;
    }): Promise<SsoConnectionState | null> {
      return states.find((state) => state.connectionId === connectionId) ?? null;
    }
    async tryFindDomainOwner({
      domain,
    }: {
      domain: string;
    }): Promise<{ connectionId: string; organizationId: string } | null> {
      const connectionId = owners[domain];
      return connectionId ? { connectionId, organizationId: "org_acme" } : null;
    }
    async findForOrganization(): Promise<SsoConnectionState[]> {
      return states;
    }
  }
  return SsoIssuerDirectoryService.create({ connections: new StubReads() });
}

describe("given a sign-in request naming a connection", () => {
  it("answers the issuer that connection registered", async () => {
    const directory = directoryOver({
      states: [connection({ connectionId: "ssoc_acme", issuer: "https://idp.acme.test" })],
    });

    expect(await directory.findIssuersForConnection({ connectionId: "ssoc_acme" })).toEqual([
      "https://idp.acme.test",
    ]);
  });

  describe("when the connection registered no issuer", () => {
    it("answers nothing, so nothing new becomes dialable", async () => {
      const directory = directoryOver({
        states: [connection({ connectionId: "ssoc_acme", issuer: null })],
      });

      expect(await directory.findIssuersForConnection({ connectionId: "ssoc_acme" })).toEqual([]);
    });
  });

  describe("when no such connection exists", () => {
    it("answers nothing rather than another tenant's issuer", async () => {
      const directory = directoryOver({ states: [] });

      expect(await directory.findIssuersForConnection({ connectionId: "ssoc_ghost" })).toEqual([]);
    });
  });
});

describe("given a sign-in request naming only an email domain", () => {
  it("answers the issuer of the connection that proved that domain", async () => {
    const directory = directoryOver({
      states: [connection({ connectionId: "ssoc_acme", issuer: "https://idp.acme.test" })],
      owners: { "acme.test": "ssoc_acme" },
    });

    expect(await directory.findIssuersForDomain({ domain: "ACME.test" })).toEqual([
      "https://idp.acme.test",
    ]);
  });

  describe("when nobody proved the domain", () => {
    it("answers nothing", async () => {
      const directory = directoryOver({
        states: [connection({ connectionId: "ssoc_acme", issuer: "https://idp.acme.test" })],
      });

      expect(await directory.findIssuersForDomain({ domain: "elsewhere.test" })).toEqual([]);
    });
  });
});
