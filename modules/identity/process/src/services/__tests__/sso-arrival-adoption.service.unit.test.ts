/** Spec: specs/identity/identifier-model.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type {
  IdentityBackfillOutcome,
  IdentityBackfillService,
} from "../identity-backfill.service.ts";
import { SsoArrivalAdoptionService } from "../sso-arrival-adoption.service.ts";

describe("adopting the user an SSO arrival admitted", () => {
  describe("when the identifier backfill is not enrolled automatically", () => {
    /** @scenario "Adopting an arriving SSO user migrates that user alone" */
    it("migrates the arriving user, and nobody else", async () => {
      const migrateUser = vi.fn(
        async (_input: { userId: string }): Promise<IdentityBackfillOutcome> => ({
          status: "migrated",
          report: { kind: "parity", diffs: [] },
        }),
      );
      const backfill = createApiFixture<IdentityBackfillService>({ migrateUser });

      await SsoArrivalAdoptionService.create(backfill).adopt({ userId: "user_sam" });

      expect(migrateUser).toHaveBeenCalledTimes(1);
      expect(migrateUser).toHaveBeenCalledWith({ userId: "user_sam" });
    });
  });
});
