import type { AuthzGrantIdInput } from "@langwatch/authz-contract";
import { getEnvironment, Ksuid, setEnvironment } from "@langwatch/ksuid";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../../repositories/memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "../../repositories/memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "../../repositories/memory/memory.authz-revocation.repository.ts";
import type { GrantRowShape } from "../../repositories/prisma/prisma.authz-grant.mapper.ts";
import { AuthzGrantIdentityService } from "../authz-grant-identity.service.ts";

/** The properties below hold for both layouts; v2 is the one new grants get. */
const deriveV2 = (input: AuthzGrantIdInput) =>
  AuthzGrantIdentityService.deriveGrantIdCandidates(input).v2;

const ORG = "org_acme";
const OCCURRED_AT = 1_755_000_000_000;

describe("grant identity", () => {
  const base = {
    organizationId: ORG,
    principal: { type: "user" as const, id: "user_alice" },
    scope: { type: "TEAM" as const, id: "team_client_a" },
    occurredAtMs: OCCURRED_AT,
  };

  describe("when the same fact is derived twice", () => {
    it("yields the same id — a KSUID with no random bits", () => {
      const a = deriveV2(base);
      const b = deriveV2({ ...base });
      expect(a).toBe(b);
      expect(a).toContain("grant_");
    });
  });

  describe("when the deriving process's ksuid environment differs", () => {
    it("derives the same id, so two processes cannot disagree about one row", () => {
      // The environment is a display prefix, but it lands in the string this
      // returns. Reading it from ambient configuration would make a worker
      // and a web pod derive two ids for one legacy row, and the
      // projection's upserts would stop converging.
      const original = getEnvironment();
      try {
        setEnvironment("dev");
        const fromDev = deriveV2(base);
        setEnvironment("staging");
        const fromStaging = deriveV2(base);

        expect(fromDev).toBe(fromStaging);
        expect(fromDev.startsWith("grant_")).toBe(true);
      } finally {
        setEnvironment(original);
      }
    });
  });

  describe("when any part of the fact differs", () => {
    it("yields a different id per scope, principal, org, token, and business time", () => {
      const ids = [
        deriveV2(base),
        deriveV2({ ...base, organizationId: "org_other" }),
        deriveV2({
          ...base,
          principal: { type: "apiKey", id: "user_alice" },
        }),
        deriveV2({
          ...base,
          scope: { type: "PROJECT", id: "team_client_a" },
        }),
        deriveV2({ ...base, resourceToken: "tok_1" }),
        deriveV2({ ...base, resourceToken: "tok_2" }),
        deriveV2({ ...base, occurredAtMs: OCCURRED_AT + 60_000 }),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("ignores sub-second differences in business time", () => {
      // KSUID timestamps are second-precision; a retry landing in the same
      // second as the original command derives the same id.
      expect(deriveV2({ ...base, occurredAtMs: OCCURRED_AT + 500 })).toBe(deriveV2(base));
    });
  });

  describe("when two facts differ only in where one field ends and the next begins", () => {
    it("still yields different ids", () => {
      // This is the whole reason the hash pre-image is joined on a unit
      // separator rather than concatenated. Without one, these two grants —
      // different principals at different scopes — share a pre-image, derive
      // one id, and the projection's upsert silently overwrites one with the
      // other.
      const left = deriveV2({
        ...base,
        principal: { type: "user", id: "a" },
        scope: { type: "TEAM", id: "bc" },
      });
      const right = deriveV2({
        ...base,
        principal: { type: "user", id: "ab" },
        scope: { type: "TEAM", id: "c" },
      });
      expect(left).not.toBe(right);
    });
  });

  describe("when the id is derived against the grants already stored", () => {
    const { v2, legacy } = AuthzGrantIdentityService.deriveGrantIdCandidates(base);

    it("offers one candidate per layout", () => {
      expect(Ksuid.parse(v2).layout).toBe("v2");
      expect(Ksuid.parse(legacy).layout).toBe("v1-legacy");
      expect(v2).not.toBe(legacy);
    });

    /** @scenario "A stored legacy grant keeps its legacy id" */
    it("reuses the legacy id a stored grant holds", () => {
      expect(
        AuthzGrantIdentityService.deriveGrantId({ ...base, storedGrantIds: new Set([legacy]) }),
      ).toBe(legacy);
    });

    /** @scenario "A new grant gets a v2 id" */
    it("gives a grant nothing holds the v2 id", () => {
      expect(AuthzGrantIdentityService.deriveGrantId({ ...base, storedGrantIds: new Set() })).toBe(
        v2,
      );
      expect(
        AuthzGrantIdentityService.deriveGrantId({ ...base, storedGrantIds: new Set([v2]) }),
      ).toBe(v2);
    });

    /** @scenario "A grant holding both ids resolves to its v2 id" */
    it("answers the v2 id when a v2 grant and its revoked legacy twin are both stored", () => {
      expect(
        AuthzGrantIdentityService.deriveGrantId({
          ...base,
          storedGrantIds: new Set([legacy, v2]),
        }),
      ).toBe(v2);
    });
  });

  describe("when a writer resolves the id against the stored grants", () => {
    const fact = {
      organizationId: ORG,
      principal: { type: "apiKey" as const, id: "key_legacy" },
      scope: { type: "ORGANIZATION" as const, id: ORG },
      occurredAtMs: OCCURRED_AT,
    };
    const { v2, legacy } = AuthzGrantIdentityService.deriveGrantIdCandidates(fact);

    function ledger() {
      const memory = AuthzMemoryStore.create();
      const reads = MemoryAuthzLedgerReadRepository.create({ memory });
      return {
        reads,
        grantIdentity: AuthzGrantIdentityService.create({ grants: reads }),
        attach: (id: string) =>
          MemoryAuthzGrantProjectionRepository.create({ memory }).append({
            kind: "grant.upsert",
            row: keyGrant(id),
          }),
        revoke: (id: string) =>
          MemoryAuthzRevocationRepository.create({ memory }).enforceGrantRevocation({
            organizationId: ORG,
            grantIds: [id],
            reason: "revocation",
            revokedAt: Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT + 60_000),
          }),
      };
    }

    /** @scenario "A revoked legacy grant is not re-minted as v2" */
    it("answers the revoked grant's legacy id, so the re-mint restores no access", async () => {
      const { reads, grantIdentity, attach, revoke } = ledger();
      await attach(legacy);
      await revoke(legacy);

      const resolved = await grantIdentity.resolveGrantId(fact);
      await attach(resolved);

      expect(resolved).toBe(legacy);
      expect(
        await reads.findStoredGrantIds({ organizationId: ORG, grantIds: [legacy, v2] }),
      ).toEqual([legacy]);
      expect(
        await reads.findLiveGrantsByIdentity({
          organizationId: ORG,
          identities: [
            {
              principalType: "API_KEY",
              principalId: "key_legacy",
              roleKey: "admin",
              scopeType: "ORGANIZATION",
              scopeId: ORG,
            },
          ],
        }),
      ).toEqual([]);
    });

    /** @scenario "Resolving a grant id twice gives one grant row" */
    it("answers v2 for a new grant, then the same id once it is stored", async () => {
      const { reads, grantIdentity, attach } = ledger();

      const first = await grantIdentity.resolveGrantId(fact);
      await attach(first);
      const second = await grantIdentity.resolveGrantId(fact);
      await attach(second);

      expect([first, second]).toEqual([v2, v2]);
      expect(
        (
          await reads.findStoredGrantIds({ organizationId: ORG, grantIds: [legacy, v2] })
        ).toSorted(),
      ).toEqual([legacy, v2].toSorted());
    });
  });
});

function keyGrant(id: string): GrantRowShape {
  return {
    id,
    organizationId: ORG,
    principalType: "API_KEY",
    principalId: "key_legacy",
    roleKey: "admin",
    legacyRole: null,
    source: "read-through-mint",
    scopeType: "ORGANIZATION",
    scopeId: ORG,
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    condition: null,
    occurredAt: Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT),
  };
}
