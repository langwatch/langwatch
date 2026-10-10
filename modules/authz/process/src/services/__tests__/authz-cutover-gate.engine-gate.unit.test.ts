/**
 * The per-organization fork between legacy authorization tables and the
 * grants ledger. Cached, so an operator's flip lands on the next read
 * after the window, not instantly - the behaviour this asserts.
 * @see specs/migration/authz-grants-rollout.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AuthzCutoverDatabase,
  PrismaAuthzCutoverRepository,
} from "../../repositories/prisma/prisma.authz-cutover.repository.ts";
import {
  AuthzCutoverGateService,
  ENGINE_GATE_CACHE_TTL_MS,
} from "../authz-cutover-gate.service.ts";

const ORGANIZATION_ID = "org_acme";

function adapterOver(
  findUnique: AuthzCutoverDatabase["systemMigrationTenantState"]["findUnique"],
): AuthzCutoverGateService {
  return AuthzCutoverGateService.create({
    repository: PrismaAuthzCutoverRepository.create({
      database: { systemMigrationTenantState: { findUnique } },
    }),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("given an organization whose migration is still in progress", () => {
  describe("when a permission is checked", () => {
    /** @scenario An organization that has not finalized reads from legacy */
    it("answers from the legacy path", async () => {
      const findUnique = vi.fn().mockResolvedValue({ status: "in_progress" });

      await expect(adapterOver(findUnique).isOn({ organizationId: ORGANIZATION_ID })).resolves.toBe(
        false,
      );
    });
  });
});

describe("given an organization that completes the migration", () => {
  describe("when the status lookup's cached answer expires", () => {
    /** @scenario Completing the authz migration moves an organization's writes onto the ledger */
    it("moves its writes onto the ledger", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-05T09:00:00.000Z"));
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ status: "finalized" });
      const adapter = adapterOver(findUnique);

      await expect(adapter.isOn({ organizationId: ORGANIZATION_ID })).resolves.toBe(false);
      // Still the cached answer: the import has landed but this pod has not
      // re-read it yet.
      await expect(adapter.isOn({ organizationId: ORGANIZATION_ID })).resolves.toBe(false);

      vi.advanceTimersByTime(ENGINE_GATE_CACHE_TTL_MS + 1_000);

      await expect(adapter.isOn({ organizationId: ORGANIZATION_ID })).resolves.toBe(true);
      expect(findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
