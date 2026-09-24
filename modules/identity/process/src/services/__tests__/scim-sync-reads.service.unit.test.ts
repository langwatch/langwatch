/**
 * @vitest-environment node
 * Identity says where each connection's sync stands, scoped to the asking
 * organization. Corresponds to specs/identity/scim-connection-sync.feature.
 */
import {
  emptyScimSync,
  ScimSyncNotFoundError,
  type ScimSyncState,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { ScimSyncReadRepository } from "../../repositories/scim-sync.repository.ts";
import { ScimSyncReadsService } from "../scim-sync-reads.service.ts";

const ACME = "org_acme";

function sync({
  connectionId,
  organizationId = ACME,
}: {
  connectionId: string;
  organizationId?: string;
}): ScimSyncState {
  return {
    ...emptyScimSync({ scimSyncId: `scimsync_${connectionId}` }),
    connectionId,
    organizationId,
  };
}

function readsOver(states: ScimSyncState[]) {
  class StubSyncs extends ScimSyncReadRepository {
    async getSync({ scimSyncId }: { scimSyncId: string }): Promise<ScimSyncState> {
      throw new ScimSyncNotFoundError(scimSyncId);
    }
    async findPageForOperator(): Promise<{ syncs: ScimSyncState[]; total: number }> {
      return { syncs: states, total: states.length };
    }
    async findByConnectionForOperator({
      connectionId,
    }: {
      connectionId: string;
    }): Promise<ScimSyncState[]> {
      return states.filter((state) => state.connectionId === connectionId);
    }
    async findForOrganization({
      organizationId,
    }: {
      organizationId: string;
    }): Promise<ScimSyncState[]> {
      return states.filter((state) => state.organizationId === organizationId);
    }
  }
  return ScimSyncReadsService.create({ syncs: new StubSyncs() });
}

describe("given an organization whose connections have synced", () => {
  it("answers every sync it holds", async () => {
    const reads = readsOver([
      sync({ connectionId: "ssoc_okta" }),
      sync({ connectionId: "ssoc_entra" }),
    ]);

    expect(
      (await reads.findForOrganization({ organizationId: ACME })).map((s) => s.connectionId),
    ).toEqual(["ssoc_okta", "ssoc_entra"]);
  });

  it("answers one connection's sync by name", async () => {
    const reads = readsOver([sync({ connectionId: "ssoc_okta" })]);

    expect(
      await reads.findByConnection({ organizationId: ACME, connectionId: "ssoc_okta" }),
    ).toMatchObject({ connectionId: "ssoc_okta" });
  });

  describe("when the connection belongs to another organization", () => {
    it("answers nothing rather than another tenant's sync", async () => {
      const reads = readsOver([sync({ connectionId: "ssoc_okta", organizationId: "org_globex" })]);

      expect(
        await reads.findByConnection({ organizationId: ACME, connectionId: "ssoc_okta" }),
      ).toBeNull();
    });
  });
});

describe("given an organization that has never synced", () => {
  it("answers an empty list, not a refusal", async () => {
    const reads = readsOver([]);

    expect(await reads.findForOrganization({ organizationId: ACME })).toEqual([]);
  });
});
