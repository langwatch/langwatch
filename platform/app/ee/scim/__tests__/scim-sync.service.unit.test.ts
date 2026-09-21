// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Two facts about one person, kept apart on purpose (D08).
 *
 * WHICH CONNECTION pushed a change lives on the sync's own history, and WHO
 * made the write is one global directory principal. This drives
 * `ScimSyncLifecycle` against a recording ledger so that separation is what
 * is asserted — including the thing that must NOT happen: a connection id
 * used as an actor.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { ScimSyncGuards } from "@langwatch/identity-server";
import { beforeEach, describe, expect, it } from "vitest";
import { ScimSyncLifecycle } from "../scim-sync.service";

const ORGANIZATION = "org_acme";
const OKTA = "conn_okta_primary";
const ENTRA = "conn_entra_contractors";
const T0 = 1_690_000_000_000;

/** A ledger that records rather than appends. */
function createLedger() {
  const commits: Array<{
    command: { type: string; data: Record<string, unknown> };
    facts: Array<{ type: string; data: Record<string, unknown> }>;
  }> = [];
  return {
    commits,
    commit: async (entry: never) => {
      commits.push(entry as never);
    },
  };
}

describe("ScimSyncLifecycle", () => {
  let ledger: ReturnType<typeof createLedger>;
  let lifecycle: ScimSyncLifecycle;

  beforeEach(() => {
    ledger = createLedger();
    lifecycle = new ScimSyncLifecycle({
      // Nothing folded yet, so every verb states its fact.
      guards: new ScimSyncGuards({ syncs: { findSync: async () => null } }),
      ledger: ledger as never,
      newCommandId: () => "scimcmd_fixed",
      now: () => T0,
    });
  });

  describe("when a connection pushes a membership change", () => {
    /** @scenario The fact records which connection pushed it, and one directory actor */
    it("names the connection on the fact, and stamps the one directory principal", async () => {
      await lifecycle.userPushed({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "create",
      });

      const [entry] = ledger.commits;
      expect(entry?.facts[0]?.data.connectionId).toBe(OKTA);
      expect(entry?.command.data.actor).toEqual({
        type: "system",
        id: SYSTEM_ACTORS.scim,
      });
    });

    it("stamps the same actor whichever connection pushed", async () => {
      await lifecycle.userPushed({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "create",
      });
      await lifecycle.userPushed({
        organizationId: ORGANIZATION,
        connectionId: ENTRA,
        userId: "user_kim",
        externalId: "c-99",
        op: "create",
      });

      const actors = ledger.commits.map((entry) => entry.command.data.actor);
      expect(actors).toEqual([actors[0], actors[0]]);
    });

    it("never uses a per-customer value as an actor", async () => {
      await lifecycle.userPushed({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "create",
      });

      const actor = ledger.commits[0]?.command.data.actor as { id: string };
      expect(actor.id).not.toBe(OKTA);
      expect(actor.id).not.toBe(ORGANIZATION);
      // The closed registry's own entry, never a string built at a call site.
      expect(Object.values(SYSTEM_ACTORS)).toContain(actor.id);
    });
  });

  describe("the command envelope", () => {
    it("keeps one directory-sync history per organization", async () => {
      await lifecycle.userPushed({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "create",
      });

      const { data } = ledger.commits[0]!.command;
      expect(data.tenantId).toBe(ORGANIZATION);
      expect(data.organizationId).toBe(ORGANIZATION);
      // The sync IS the connection, so no lookup stands between a token and
      // the history it writes to.
      expect(data.scimSyncId).toBe(OKTA);
    });
  });

  describe("when a guard states nothing", () => {
    it("appends nothing, so a repeated push costs no event", async () => {
      const quiet = new ScimSyncLifecycle({
        guards: new ScimSyncGuards({
          syncs: async () => null,
        } as never),
        ledger: ledger as never,
      });
      // A guard object whose verbs answer empty stands in for "the state
      // already says this".
      Object.assign(quiet, {
        guards: { recordScimUserPush: async () => [] },
      });

      await quiet.userPushed({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        userId: "user_sam",
        externalId: "u-1",
        op: "update",
      });

      expect(ledger.commits).toEqual([]);
    });
  });
});
