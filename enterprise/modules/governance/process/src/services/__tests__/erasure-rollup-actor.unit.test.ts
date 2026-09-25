// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's `actorIdForRollupWrite`: the stand-in the cost rollup keys an erased spender by (ADR-128 §9 step 5). */
import { describe, expect, it } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { erasureDigest } from "../../rules/erasure-digest.rules.ts";
import { ErasureSuppressionService } from "../erasure-suppression.service.ts";

const SECRET = "b".repeat(32);
const ERASED = "leaver@acme.test";
const ERASED_DIGEST = erasureDigest({ secret: SECRET, identifier: ERASED });

function serviceWith(erasureSecret: string | undefined) {
  const repositories = MemoryGovernanceRepositories.create();
  return ErasureSuppressionService.create({
    suppressions: repositories.erasedIdentifierSuppressions,
    tenantHistory: repositories.tenantHistory,
    erasureSecret,
  });
}

const snapshotErasing = (digests: readonly string[]) => ({
  hasAnySuppressionForTenant: (tenantId: string) => tenantId === "tenant-1" && digests.length > 0,
  isSuppressedForTenant: ({ identifierHash }: { tenantId: string; identifierHash: string }) =>
    digests.includes(identifierHash),
});

describe("the spender a cost rollup cell is keyed by", () => {
  describe("given the organization erased this spender", () => {
    it("keys the cell by the stand-in, never the original", () => {
      const actorId = serviceWith(SECRET).actorIdForRollupWrite({
        tenantId: "tenant-1",
        rawActorId: ERASED,
        snapshot: snapshotErasing([ERASED_DIGEST]),
      });

      expect(actorId).toBe(ERASED_DIGEST);
    });
  });

  describe("given the organization erased somebody else", () => {
    it("keeps the spender as the provider named them", () => {
      const actorId = serviceWith(SECRET).actorIdForRollupWrite({
        tenantId: "tenant-1",
        rawActorId: "stays@acme.test",
        snapshot: snapshotErasing([ERASED_DIGEST]),
      });

      expect(actorId).toBe("stays@acme.test");
    });
  });

  describe("given an erasure but no erasure secret in this process", () => {
    it("refuses rather than writing an erased address into the cost table", () => {
      expect(() =>
        serviceWith(undefined).actorIdForRollupWrite({
          tenantId: "tenant-1",
          rawActorId: ERASED,
          snapshot: snapshotErasing([ERASED_DIGEST]),
        }),
      ).toThrow(/no erasure secret/);
    });
  });

  describe("given a day the provider named nobody for", () => {
    it("keeps the blank spender without consulting erasure", () => {
      const actorId = serviceWith(undefined).actorIdForRollupWrite({
        tenantId: "tenant-1",
        rawActorId: "",
        snapshot: snapshotErasing([ERASED_DIGEST]),
      });

      expect(actorId).toBe("");
    });
  });
});
