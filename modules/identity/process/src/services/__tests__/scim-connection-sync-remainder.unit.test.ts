/**
 * D08's remainder, over the real guards: a token belongs to one connection,
 * its pushes are attributed to it, and every membership a push causes is
 * explained by a fact (specs/identity/scim-connection-sync.feature).
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncFactInput,
  type ScimSyncState,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type { ScimSyncReadRepository } from "../../repositories/scim-sync.repository.ts";
import { ScimSyncGuardsService } from "../scim-sync-guards.service.ts";

const ORG = "org_acme";
const OKTA = "ssoc_okta_primary";
const ENTRA = "ssoc_entra_contractors";
const T0 = 1_756_000_000_000;
const SCIM = { type: "system" as const, id: SYSTEM_ACTORS.scim };

/** The folded head the guards read, in memory and local to this file. */
class MemorySyncs implements ScimSyncReadRepository {
  private readonly held = new Map<string, ScimSyncState>();

  seed(sync: ScimSyncState): void {
    this.held.set(sync.scimSyncId, sync);
  }

  async tryFindSync({
    scimSyncId,
    organizationId,
  }: {
    scimSyncId: string;
    organizationId: string;
  }): Promise<ScimSyncState | null> {
    const sync = this.held.get(scimSyncId);

    return sync && sync.organizationId === organizationId ? sync : null;
  }
}

let syncs: MemorySyncs;
let guards: ScimSyncGuardsService;
let minted: number;

const command = (connectionId: string) => ({
  tenantId: ORG,
  organizationId: ORG,
  scimSyncId: `scimsync_${connectionId}`,
  connectionId,
  commandId: `cmd_${(minted += 1)}`,
  occurredAtMs: T0,
  actor: SCIM,
});

const connectionsNamedBy = (facts: ScimSyncFactInput[]): unknown[] =>
  facts.map((fact) => Reflect.get(fact.data, "connectionId"));

beforeEach(() => {
  syncs = new MemorySyncs();
  guards = ScimSyncGuardsService.create({ syncs });
  minted = 0;
});

describe("a directory token and the connection it belongs to", () => {
  describe("when one is minted for a connection", () => {
    /** @scenario "A token is issued against exactly one connection" */
    it("names that connection, and attributes the pushes made with it to it", async () => {
      const issued = await guards.issueScimToken({ ...command(OKTA), tokenId: "scimtok_1" });

      expect(issued).toEqual([
        {
          type: SCIM_TOKEN_ISSUED_EVENT_TYPE,
          data: expect.objectContaining({
            connectionId: OKTA,
            organizationId: ORG,
            tokenId: "scimtok_1",
          }),
        },
      ]);

      // A push authenticated with it is attributed to the same connection —
      // which is where "which directory did this" lives, since the actor is
      // one global principal.
      const pushed = await guards.recordScimUserPush({
        ...command(OKTA),
        userId: "user_sam",
        externalId: "u-1",
        op: "create",
      });
      expect(pushed[0]).toMatchObject({
        type: SCIM_USER_PUSHED_EVENT_TYPE,
        data: { connectionId: OKTA, userId: "user_sam" },
      });
    });
  });

  describe("when two directories both push the same person", () => {
    /** @scenario "The fact records which connection pushed it, and one directory actor" */
    it("names each connection on its own fact and stamps the one directory principal", async () => {
      const first = await guards.recordScimUserPush({
        ...command(OKTA),
        userId: "user_sam",
        externalId: "u-1",
        op: "update",
      });
      const second = await guards.recordScimUserPush({
        ...command(ENTRA),
        userId: "user_sam",
        externalId: "c-9",
        op: "update",
      });

      expect(connectionsNamedBy(first)).toEqual([OKTA]);
      expect(connectionsNamedBy(second)).toEqual([ENTRA]);
      // The same actor on both, and a registered system principal — never a
      // per-customer value like a connection id.
      const issued = await guards.issueScimToken({ ...command(ENTRA), tokenId: "scimtok_2" });
      expect(Reflect.get(issued[0]?.data ?? {}, "actor")).toEqual(SCIM);
      expect(SCIM.id).not.toBe(OKTA);
      expect(SCIM.id).not.toBe(ENTRA);
    });
  });

  describe("when a full push, group and removal cycle has been synced", () => {
    /** @scenario "Every membership a directory push causes is explained by an event" */
    it("names every person the directory touched, on a fact that names the connection", async () => {
      const stated = [
        ...(await guards.recordScimUserPush({
          ...command(OKTA),
          userId: "user_sam",
          externalId: "u-1",
          op: "create",
        })),
        ...(await guards.recordScimGroupMapping({
          ...command(OKTA),
          groupId: "group_eng",
          externalId: "g-1",
        })),
        ...(await guards.recordScimUserPush({
          ...command(OKTA),
          userId: "user_sam",
          externalId: "u-1",
          op: "deactivate",
        })),
      ];

      const people = new Set(
        stated
          .filter((fact) => fact.type === SCIM_USER_PUSHED_EVENT_TYPE)
          .map((fact) => Reflect.get(fact.data, "userId")),
      );
      expect([...people]).toEqual(["user_sam"]);
      expect(connectionsNamedBy(stated).every((connection) => connection === OKTA)).toBe(true);
      // Nothing landed outside that path: the guards have no verb that writes
      // a membership, so a membership no fact accounts for cannot be produced
      // here at all.
      expect(stated).toHaveLength(3);
    });
  });

  describe("given the sync has been revoked", () => {
    it("states nothing for a push arriving after the revocation", async () => {
      syncs.seed({
        scimSyncId: `scimsync_${OKTA}`,
        organizationId: ORG,
        connectionId: OKTA,
        state: "REVOKED",
        lastPushedAtMs: T0,
        lastFailure: null,
        deadLetters: [],
        revokedCause: "teardown",
        createdAtMs: T0,
        updatedAtMs: T0,
      });

      expect(
        await guards.recordScimUserPush({
          ...command(OKTA),
          userId: "user_sam",
          externalId: "u-1",
          op: "update",
        }),
      ).toEqual([]);
    });
  });
});
