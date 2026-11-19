/**
 * A role delete that was not waited for is still seen by the next define of that role: the
 * adapter marks it at once, so a retried API key role definition neither skips nor confirms on a
 * role about to go. The real adapter runs over the memory repositories; no command ever folds.
 * @see specs/rbac/authz-grants.feature
 */
import type { LedgerActor } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzLedgerReadRepository } from "../../repositories/memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "../../repositories/memory/memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzRevocationRepository } from "../../repositories/memory/memory.authz-revocation.repository.ts";
import { MemoryAuthzEpochRepository } from "../../repositories/memory/memory.authz.repositories.ts";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../services/authz-grants-command-dispatcher.service.ts";
import { EventingAuthzLedgerAdapter } from "../authz-grant.store.ts";

const ORG_ID = "org_in_flight";
const ROLE_ID = "apikey:key_1";
const ACTOR: LedgerActor = { type: "system", id: null };
const at = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms);

/** Records every command and folds none, so each append stays in flight. */
class UnfoldedDispatcher extends AuthzGrantsCommandDispatcher {
  readonly sent: string[] = [];

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    const record = (verb: string) => ({
      send: async () => {
        this.sent.push(verb);
      },
    });
    return {
      commands: {
        attachGrant: record("attachGrant"),
        changeGrantRole: record("changeGrantRole"),
        revokeGrant: record("revokeGrant"),
        defineRole: record("defineRole"),
        changeRolePermissions: record("changeRolePermissions"),
        deleteRole: record("deleteRole"),
      },
    };
  }
}

describe("given an API key's own role, live with the definition a retry restates", () => {
  describe("when the role is deleted without waiting and then defined again", () => {
    /** @scenario "A define after a delete not waited for is sent and not confirmed" */
    it("sends the definition and refuses it, the role staying deleted", async () => {
      const memory = AuthzMemoryStore.create();
      memory.roleHeads.push({
        id: ROLE_ID,
        organizationId: ORG_ID,
        name: ROLE_ID,
        description: null,
        permissions: ["traces:view"],
        kind: "system_api_key",
        occurredAt: at(1_000),
        deletedAt: null,
        updatedAt: at(1_000),
      });
      const dispatcher = new UnfoldedDispatcher();
      const ledger = EventingAuthzLedgerAdapter.create({
        reads: MemoryAuthzLedgerReadRepository.create({ memory }),
        lineage: { findProjectLineage: async () => null },
        dispatcher,
        epoch: MemoryAuthzEpochRepository.create({ memory }),
        revocation: MemoryAuthzRevocationRepository.create({ memory }),
        membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
        poll: { intervalMs: 1, timeoutMs: 5 },
      });

      await ledger.deleteRole({
        organizationId: ORG_ID,
        roleId: ROLE_ID,
        actor: ACTOR,
        awaitProjection: false,
      });
      const defined = ledger.defineRole({
        organizationId: ORG_ID,
        roleId: ROLE_ID,
        name: ROLE_ID,
        permissions: ["traces:view"],
        kind: "system_api_key",
        actor: ACTOR,
        requireProjection: true,
      });

      await expect(defined).rejects.toMatchObject({ code: "authz_grant_not_confirmed" });
      expect(dispatcher.sent).toEqual(["deleteRole", "defineRole"]);
      expect(memory.roleHeads[0]?.deletedAt).not.toBeNull();
    });
  });
});
