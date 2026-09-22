/**
 * @vitest-environment node
 * What an unfinished automatic admission means, over the memory backend: the
 * marker says one is open, the ledger says whether the grant landed.
 */
import { describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzAdmissionRepository } from "../../repositories/memory/memory.authz-admission.repository.ts";
import { AuthzAdmissionService } from "../authz-admission.service.ts";

const ORGANIZATION_ID = "org_admission";
const USER_ID = "user_admission";
const GRANT_ID = "rb_admission";
const SCOPE = { organizationId: ORGANIZATION_ID, userId: USER_ID };

function harness() {
  const memory = AuthzMemoryStore.create();
  const service = AuthzAdmissionService.create({
    admissions: MemoryAuthzAdmissionRepository.create({ memory }),
  });
  return { memory, service };
}

function openAdmission(memory: AuthzMemoryStore): void {
  memory.admissions.push({
    ...SCOPE,
    grantId: GRANT_ID,
    occurredAtMs: 1_700_000_000_000,
    disabled: false,
    deactivated: false,
  });
}

describe("an automatic single-sign-on admission", () => {
  describe("when the membership carries no marker", () => {
    it("is not pending", async () => {
      const { service } = harness();

      await expect(service.readPendingAdmission(SCOPE)).resolves.toEqual({ pending: false });
    });
  });

  describe("when the marker is open and the ledger holds no grant", () => {
    it("reads as pending, keeping the original identity and business time", async () => {
      const { memory, service } = harness();
      openAdmission(memory);

      await expect(service.readPendingAdmission(SCOPE)).resolves.toEqual({
        pending: true,
        admission: { grantId: GRANT_ID, occurredAtMs: 1_700_000_000_000, state: "pending" },
      });
    });
  });

  describe("when the ledger holds a live grant for the marker", () => {
    it("reads as applied, and completing clears the marker", async () => {
      const { memory, service } = harness();
      openAdmission(memory);
      memory.admissionGrants.push({ ...SCOPE, grantId: GRANT_ID, revoked: false });

      await expect(service.readPendingAdmission(SCOPE)).resolves.toEqual({
        pending: true,
        admission: { grantId: GRANT_ID, occurredAtMs: 1_700_000_000_000, state: "applied" },
      });
      await expect(service.completeAdmission({ ...SCOPE, grantId: GRANT_ID })).resolves.toBe(true);
      await expect(service.readPendingAdmission(SCOPE)).resolves.toEqual({ pending: false });
    });
  });

  describe("when the ledger took the grant back", () => {
    it("reads as revoked, and clearing leaves no marker for a retry to revive", async () => {
      const { memory, service } = harness();
      openAdmission(memory);
      memory.admissionGrants.push({ ...SCOPE, grantId: GRANT_ID, revoked: true });

      await expect(service.readPendingAdmission(SCOPE)).resolves.toEqual({
        pending: true,
        admission: { grantId: GRANT_ID, occurredAtMs: 1_700_000_000_000, state: "revoked" },
      });
      await expect(service.completeAdmission({ ...SCOPE, grantId: GRANT_ID })).resolves.toBe(false);
      await expect(service.clearPendingAdmission({ ...SCOPE, grantId: GRANT_ID })).resolves.toBe(
        true,
      );
      await expect(service.readPendingAdmission(SCOPE)).resolves.toEqual({ pending: false });
    });
  });
});
