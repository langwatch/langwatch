// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Two facts about one person, kept apart on purpose (D08).
 *
 * WHICH CONNECTION pushed a change lives on the sync's own history, and WHO
 * made the write is one global directory principal. This drives the lifecycle
 * against a recording ledger so that separation is what is asserted —
 * including the thing that must NOT happen: a connection id used as an actor.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncCommand,
  type ScimSyncFactInput,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ScimSyncLifecycleService,
  type ScimSyncLifecycleGuards,
  type ScimSyncLifecycleLedger,
} from "../scim-sync-lifecycle.service.ts";

const ORGANIZATION = "org_acme";
const OKTA = "conn_okta_primary";
const ENTRA = "conn_entra_contractors";
const T0 = 1_690_000_000_000;

/** A ledger that records rather than appends. */
function createLedger(): ScimSyncLifecycleLedger & {
  commits: { command: ScimSyncCommand; facts: ScimSyncFactInput[] }[];
} {
  const commits: { command: ScimSyncCommand; facts: ScimSyncFactInput[] }[] = [];

  return {
    commits,
    commit: async (entry) => {
      commits.push(entry);
    },
  };
}

/**
 * Guards that state one fact per call. The guard's own decisions — the state
 * already says this, the transition is refused — are identity's, and are
 * tested there; what is asked here is what the adapter does with the answer.
 */
function statingGuards(): ScimSyncLifecycleGuards {
  const fact = (data: {
    scimSyncId: string;
    connectionId: string;
    organizationId: string;
  }): ScimSyncFactInput[] => [
    {
      type: SCIM_USER_PUSHED_EVENT_TYPE,
      data: { ...data, userId: "user_sam", externalId: "u-1", op: "create" },
    },
  ];

  return {
    issueScimToken: async (data) => fact(data),
    recordScimUserPush: async (data) => fact(data),
    recordScimGroupMapping: async (data) => fact(data),
    recordScimApplyFailure: async (data) => fact(data),
    redriveScimApply: async (data) => fact(data),
    revokeScimSync: async (data) => fact(data),
  };
}

/** Guards that say the state already carries this: nothing new to state. */
function quietGuards(): ScimSyncLifecycleGuards {
  return {
    issueScimToken: async () => [],
    recordScimUserPush: async () => [],
    recordScimGroupMapping: async () => [],
    recordScimApplyFailure: async () => [],
    redriveScimApply: async () => [],
    revokeScimSync: async () => [],
  };
}

describe("ScimSyncLifecycleService", () => {
  let ledger: ReturnType<typeof createLedger>;
  let lifecycle: ScimSyncLifecycleService;

  beforeEach(() => {
    ledger = createLedger();
    lifecycle = ScimSyncLifecycleService.create({
      guards: statingGuards(),
      ledger,
      newCommandId: () => "scimcmd_fixed",
      now: () => T0,
    });
  });

  describe("when a connection pushes a membership change", () => {
    /** @scenario "The fact records which connection pushed it, and one directory actor" */
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
      expect(entry?.command.data.actor).toEqual({ type: "system", id: SYSTEM_ACTORS.scim });
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

      const actor = ledger.commits[0]?.command.data.actor;
      expect(actor?.id).not.toBe(OKTA);
      expect(actor?.id).not.toBe(ORGANIZATION);
      // The closed registry's own entry, never a string built at a call site.
      expect(Object.values(SYSTEM_ACTORS)).toContain(actor?.id);
    });
  });

  describe("given the command envelope", () => {
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

    it("mints a command id per call, because a nightly re-push is a new attempt", async () => {
      const ids: string[] = [];
      const counting = ScimSyncLifecycleService.create({
        guards: statingGuards(),
        ledger,
        newCommandId: () => `scimcmd_${ids.push("x")}`,
        now: () => T0,
      });

      await counting.tokenIssued({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        tokenId: "token_1",
      });
      await counting.revoked({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        tokenId: "token_1",
        cause: "revoke",
      });

      const commandIds = ledger.commits.map((entry) => entry.command.data.commandId);
      expect(new Set(commandIds).size).toBe(2);
    });
  });

  describe("when a guard states nothing", () => {
    it("appends nothing, so a repeated push costs no event", async () => {
      const quiet = ScimSyncLifecycleService.create({
        guards: quietGuards(),
        ledger,
        newCommandId: () => "scimcmd_fixed",
        now: () => T0,
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
