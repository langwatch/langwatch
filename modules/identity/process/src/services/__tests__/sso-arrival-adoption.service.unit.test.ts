/** Spec: specs/identity/identifier-model.feature and saml-existing-user-linking.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryIdentityLatchRepository } from "../../repositories/memory/memory.identity-latch.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import type {
  IdentityBackfillOutcome,
  IdentityBackfillService,
} from "../identity-backfill.service.ts";
import { SsoArrivalAdoptionService } from "../sso-arrival-adoption.service.ts";

function adoptionAnswering(outcome: IdentityBackfillOutcome) {
  const migrateUser = vi.fn(async (_input: { userId: string }) => outcome);
  const latch = MemoryIdentityLatchRepository.create(MemoryIdentityStore.create());
  const adoption = SsoArrivalAdoptionService.create({
    backfill: createApiFixture<IdentityBackfillService>({ migrateUser }),
    latch,
  });

  return { adoption, latch, migrateUser };
}

describe("adopting the user an SSO arrival admitted", () => {
  describe("when the identifier backfill is not enrolled automatically", () => {
    /** @scenario "Adopting an arriving SSO user migrates that user alone" */
    it("migrates the arriving user, and nobody else", async () => {
      const { adoption, migrateUser } = adoptionAnswering({
        status: "migrated",
        report: { kind: "parity", diffs: [] },
      });

      await adoption.adopt({ userId: "user_sam" });

      expect(migrateUser).toHaveBeenCalledTimes(1);
      expect(migrateUser).toHaveBeenCalledWith({ userId: "user_sam" });
    });
  });

  describe("when the arriving user's backfill finalizes", () => {
    it("records D01 finalized for that user, so the latch opens without the runner", async () => {
      const { adoption, latch } = adoptionAnswering({
        status: "finalized",
        report: { kind: "adopted", identifiers: 1 },
      });

      await adoption.adopt({ userId: "user_sam" });

      expect(await latch.isFinalized({ userId: "user_sam" })).toBe(true);
      expect(await latch.isFinalized({ userId: "user_other" })).toBe(false);
    });
  });

  describe("when the arriving user's backfill is held", () => {
    it("records nothing, leaving the user to the runner's next pass", async () => {
      const { adoption, latch } = adoptionAnswering({
        status: "migrated",
        report: { kind: "parity", diffs: [] },
      });

      await adoption.adopt({ userId: "user_sam" });

      expect(await latch.hasAnyoneFinalized()).toBe(false);
    });
  });
});
