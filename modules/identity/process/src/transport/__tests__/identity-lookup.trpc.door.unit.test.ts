/**
 * The identity lookup behind the platform door (Q51): a caller without ops:manage is answered
 * not-found before the module runs, and the refusal is recorded within the stranger budget.
 * Spec: specs/identity/platform-ops-identity-lookup.feature.
 */
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { IdentityLookupApi } from "@langwatch/identity-contract";
import type { RateLimiter } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { identityLookupDoor, refusalOf } from "../../__tests__/support/identity-lookup-door.ts";
import { MemoryIdentityLookupRepository } from "../../repositories/memory/memory.identity-lookup.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import {
  IdentityLookupService,
  type IdentityLookupServiceDeps,
} from "../../services/identity-lookup.service.ts";

const OLIVE = "user_olive";
const MALLORY = "user_mallory";

function fixedWindow(max: number): RateLimiter {
  const counts = new Map<string, number>();
  return {
    async check(key: string) {
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      return used <= max ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 };
    },
  };
}

function lookupBehindTheDoor({ budget }: { budget: number }) {
  const trail: RecordAuditLogCommand[] = [];
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (command) => {
      trail.push(command);
      return { id: `audit_${trail.length}`, occurredAt: 0 };
    },
  });
  const service = IdentityLookupService.create({
    reads: MemoryIdentityLookupRepository.create(MemoryIdentityStore.create()),
    router: {
      route: async () => ({
        outcome: "route_to_signup",
        reasonCode: "identifier_unknown",
        connectionId: undefined,
        methodSet: [],
      }),
    },
    history: createApiFixture<IdentityLookupServiceDeps["history"]>({}),
    identity: () => createApiFixture({}),
    links: createApiFixture<IdentityLookupServiceDeps["links"]>({}),
    sessions: createApiFixture<IdentityLookupServiceDeps["sessions"]>({}),
    invitations: createApiFixture<IdentityLookupServiceDeps["invitations"]>({}),
    auditLog,
    rateLimiter: fixedWindow(budget),
  });
  const door = identityLookupDoor({
    app: service,
    operators: [OLIVE],
  });

  return { door, trail };
}

describe("identity lookup at the platform door", () => {
  describe("when mallory, holding no platform operator access, asks over and over", () => {
    /** @scenario "A stranger cannot fill the trail with their own attempts" */
    it("records her first attempts, drops the rest, and refuses every one alike", async () => {
      const { door, trail } = lookupBehindTheDoor({ budget: 2 });

      const refusals = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        refusals.push(
          refusalOf(
            await door
              .as(MALLORY)
              .resolve({ address: "Sam@Acme.com" })
              .catch((error: unknown) => error),
          ),
        );
      }

      expect(trail).toHaveLength(2);
      expect(trail.map((row) => [row.userId, row.action, row.args])).toEqual([
        [MALLORY, "identityLookup.resolve", { address: "sam@acme.com" }],
        [MALLORY, "identityLookup.resolve", { address: "sam@acme.com" }],
      ]);
      expect(new Set(refusals.map((refusal) => JSON.stringify(refusal))).size).toBe(1);
      expect(refusals[0]).toMatchObject({ trpc: "NOT_FOUND", code: "not_found" });
    });
  });

  describe("when mallory or an anonymous caller opens any lookup procedure directly", () => {
    /** @scenario "Without platform operator access the surface is not there at all" */
    it("answers the generic not_found before the module runs", async () => {
      const reached: string[] = [];
      const recorded: string[] = [];
      const reach = (name: string) => async () => {
        reached.push(name);
        throw new Error("the door admitted the caller");
      };
      const app = createApiFixture<IdentityLookupApi>({
        lookupAddress: reach("lookupAddress"),
        findDomainClaimQueue: reach("findDomainClaimQueue"),
        confirmProposedSignIn: reach("confirmProposedSignIn"),
        recordRefusedLookup: async ({ operator, action }) => {
          recorded.push(`${operator.userId}:${action}`);
        },
      });
      const door = identityLookupDoor({ app, operators: [OLIVE] });

      const answers = [
        await door
          .as(MALLORY)
          .resolve({ address: "sam@acme.com" })
          .catch((e: unknown) => e),
        await door
          .as(MALLORY)
          .claimQueue({})
          .catch((e: unknown) => e),
        await door
          .as(MALLORY)
          .confirmProposedSignIn({ userId: "user_sam", proposalId: "prop_1" })
          .catch((e: unknown) => e),
        await door
          .as(null)
          .resolve({ address: "sam@acme.com" })
          .catch((e: unknown) => e),
      ].map(refusalOf);

      expect(answers.every((answer) => answer.trpc === "NOT_FOUND")).toBe(true);
      expect(answers.every((answer) => answer.code === "not_found")).toBe(true);
      expect(reached).toEqual([]);
      expect(recorded).toEqual([
        `${MALLORY}:resolve`,
        `${MALLORY}:claimQueue`,
        `${MALLORY}:confirmProposedSignIn`,
      ]);
    });
  });

  describe("when olive, a platform operator, resolves an address", () => {
    it("admits her and records the act once, past any stranger's budget", async () => {
      const { door, trail } = lookupBehindTheDoor({ budget: 0 });

      const answer = await door.as(OLIVE).resolve({ address: "nobody@acme.com" });

      expect(answer.people).toEqual([]);
      expect(trail.map((row) => [row.userId, row.action])).toEqual([
        [OLIVE, "identityLookup.resolve"],
      ]);
    });
  });
});
