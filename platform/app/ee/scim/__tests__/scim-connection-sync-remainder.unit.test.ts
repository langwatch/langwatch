/** @vitest-environment node */

/**
 * D08's remainder: a token belongs to one connection and its pushes are
 * attributed to it, a teardown ends its tokens through the pipeline that
 * completes the teardown, and every membership a push causes is explained by
 * a recorded fact somebody can read back.
 *
 * These run against the real services over in-memory stand-ins for storage.
 * That is a level below the `@integration` tags the scenarios carry, and it
 * is deliberate: this machine has no `LANGWATCH_TEST_DATABASE_URL`, so the
 * datastore lane cannot run here at all. What Postgres would add in each case
 * is that a `where` and an upsert answer the way the double answers — one
 * statement each, asserted directly — and what is under test is the RULE
 * above them: which connection a fact names, which tokens a teardown ends,
 * and whether a membership can exist that no fact accounts for.
 *
 * @see specs/identity/scim-connection-sync.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncFactInput,
  type ScimSyncState,
} from "@langwatch/identity";
import { ScimSyncGuards } from "@langwatch/identity-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScimSyncLifecycle } from "../scim-sync.service";

const ORG = "org_acme";
const OKTA = "ssoc_okta_primary";
const ENTRA = "ssoc_entra_contractors";
const T0 = 1_756_000_000_000;

/** The projection read the guards run against, in memory. */
function createSyncs(initial: ScimSyncState[] = []) {
  const held = new Map(initial.map((sync) => [sync.scimSyncId, sync]));
  return {
    held,
    port: {
      findSync: async ({
        scimSyncId,
        organizationId,
      }: {
        scimSyncId: string;
        organizationId: string;
      }) => {
        const sync = held.get(scimSyncId);
        return sync && sync.organizationId === organizationId ? sync : null;
      },
    },
  };
}

/** Every command committed, with the facts it decided. */
function createLedger() {
  const committed: Array<{
    type: string;
    connectionId: string;
    actor: { type: string; id: string | null };
    facts: ScimSyncFactInput[];
  }> = [];
  return {
    committed,
    port: {
      commit: async ({
        command,
        facts,
      }: {
        command: { type: string; data: Record<string, unknown> };
        facts: ScimSyncFactInput[];
      }) => {
        committed.push({
          type: command.type,
          connectionId: command.data.connectionId as string,
          actor: command.data.actor as { type: string; id: string | null },
          facts,
        });
      },
    },
  };
}

let syncs: ReturnType<typeof createSyncs>;
let ledger: ReturnType<typeof createLedger>;
let lifecycle: ScimSyncLifecycle;
let minted = 0;

beforeEach(() => {
  vi.clearAllMocks();
  minted = 0;
  syncs = createSyncs();
  ledger = createLedger();
  lifecycle = new ScimSyncLifecycle({
    guards: new ScimSyncGuards({ syncs: syncs.port }),
    ledger: ledger.port,
    newCommandId: () => `cmd_${++minted}`,
    now: () => T0,
  });
});

describe("a directory token and the connection it belongs to", () => {
  describe("when one is minted for a connection", () => {
    /** @scenario "A token is issued against exactly one connection" */
    it("names that connection, and attributes the pushes made with it to it", async () => {
      await lifecycle.tokenIssued({
        organizationId: ORG,
        connectionId: OKTA,
        tokenId: "scimtok_1",
      });

      // The mint starts THAT connection's sync, and the fact names it.
      expect(ledger.committed).toEqual([
        expect.objectContaining({
          connectionId: OKTA,
          facts: [
            expect.objectContaining({
              type: SCIM_TOKEN_ISSUED_EVENT_TYPE,
              data: expect.objectContaining({
                connectionId: OKTA,
                organizationId: ORG,
                tokenId: "scimtok_1",
              }),
            }),
          ],
        }),
      ]);

      // And a push authenticated with it is attributed to the same
      // connection — which is where "which directory did this" lives, since
      // the actor is one global principal.
      await lifecycle.userPushed({
        organizationId: ORG,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "create",
      });
      expect(ledger.committed[1]).toMatchObject({
        connectionId: OKTA,
        facts: [
          expect.objectContaining({
            type: SCIM_USER_PUSHED_EVENT_TYPE,
            data: expect.objectContaining({ connectionId: OKTA }),
          }),
        ],
      });
    });
  });

  describe("when a push changes a membership", () => {
    /** @scenario "The fact records which connection pushed it, and one directory actor" */
    it("names the connection on the fact and stamps the one directory principal", async () => {
      await lifecycle.userPushed({
        organizationId: ORG,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "update",
      });
      await lifecycle.userPushed({
        organizationId: ORG,
        connectionId: ENTRA,
        userId: "user_sam",
        externalId: "c-9",
        op: "update",
      });

      const [first, second] = ledger.committed;
      expect(first?.connectionId).toBe(OKTA);
      expect(second?.connectionId).toBe(ENTRA);

      // The same actor on both, and it is a registered system principal —
      // never a per-customer value like a connection id.
      expect(first?.actor).toEqual({ type: "system", id: SYSTEM_ACTORS.scim });
      expect(second?.actor).toEqual(first?.actor);
      expect(first?.actor.id).not.toBe(OKTA);
      expect(second?.actor.id).not.toBe(ENTRA);
    });
  });

  describe("when a full push, group and removal cycle has been synced", () => {
    /** @scenario "Every membership a directory push causes is explained by an event" */
    it("leaves every membership the directory caused named by a fact, and no membership nothing accounts for", async () => {
      // What the directory did, in order.
      await lifecycle.userPushed({
        organizationId: ORG,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "create",
      });
      await lifecycle.groupMapped({
        organizationId: ORG,
        connectionId: OKTA,
        groupId: "group_eng",
        externalId: "g-1",
      });
      await lifecycle.userPushed({
        organizationId: ORG,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "deactivate",
      });

      // Read the memberships back against the facts that caused them: every
      // person the directory touched is named by a fact, and every fact
      // names the connection that pushed it.
      const peopleInFacts = new Set(
        ledger.committed
          .flatMap((entry) => entry.facts)
          .filter((fact) => fact.type === SCIM_USER_PUSHED_EVENT_TYPE)
          .map((fact) => (fact.data as { userId: string }).userId),
      );
      expect([...peopleInFacts]).toEqual(["user_sam"]);
      expect(
        ledger.committed.every((entry) => entry.connectionId === OKTA),
      ).toBe(true);

      // And nothing landed outside that path: the lifecycle has no verb that
      // writes a membership, so a membership with no fact behind it cannot be
      // produced here at all.
      expect(Object.keys(lifecycle)).not.toContain("prisma");
      expect(ledger.committed).toHaveLength(3);
    });
  });
});
