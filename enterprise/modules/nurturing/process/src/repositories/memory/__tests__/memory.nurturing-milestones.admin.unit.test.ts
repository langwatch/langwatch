// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * The Postgres twin's order-free admin fold, held by the memory twin.
 * Spec: enterprise/modules/nurturing/specs/nurturing.feature,
 * enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import { describe, expect, it } from "vitest";

import type { NurturingOrganizationAdminRepository } from "../../nurturing-milestones.repository.ts";
import { MemoryNurturingErasedUserRepository } from "../memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../memory.nurturing-milestones.repository.ts";

type AdminFact = Parameters<NurturingOrganizationAdminRepository["recordAdminFact"]>[0];

const fact = (overrides: Partial<AdminFact>): AdminFact => ({
  organizationId: "org-1",
  adminUserId: "admin-a",
  at: 1_000,
  seeded: false,
  ...overrides,
});

async function adminAfter(facts: readonly AdminFact[]) {
  const organizations = MemoryNurturingMilestonesRepository.create();
  for (const next of facts) await organizations.recordAdminFact(next);
  const [row] = await organizations.findOrganization({ organizationId: "org-1" });
  return { adminUserId: row?.adminUserId, seeded: row?.seeded };
}

describe("MemoryNurturingMilestonesRepository.recordAdminFact", () => {
  describe("when the same facts land in one order and in its reverse", () => {
    /** @scenario "The organization's admin is the latest-stamped one whatever order the facts land in" */
    it("names the latest-stamped admin and keeps seeded on, both ways", async () => {
      const facts = [
        fact({ adminUserId: "admin-a", at: 1_000 }),
        fact({ adminUserId: "admin-c", at: 3_000 }),
        fact({ adminUserId: null, at: 4_000, seeded: true }),
        fact({ adminUserId: "admin-b", at: 2_000 }),
      ];

      const expected = { adminUserId: "admin-c", seeded: true };
      await expect(adminAfter(facts)).resolves.toEqual(expected);
      await expect(adminAfter(facts.toReversed())).resolves.toEqual(expected);
    });

    it("keeps the greater id for two admins at one stamp", async () => {
      const tied = [fact({ adminUserId: "admin-a" }), fact({ adminUserId: "admin-b" })];

      await expect(adminAfter(tied)).resolves.toMatchObject({ adminUserId: "admin-b" });
      await expect(adminAfter(tied.toReversed())).resolves.toMatchObject({
        adminUserId: "admin-b",
      });
    });
  });

  describe("when a later fact names a marked person admin", () => {
    /** @scenario "A late project-created fact naming an erased admin writes no admin" */
    it("names no admin, and an older fact naming another person does not refill it", async () => {
      const erasedUsers = MemoryNurturingErasedUserRepository.create();
      const organizations = MemoryNurturingMilestonesRepository.create({ erasedUsers });
      await organizations.recordAdminFact(fact({ adminUserId: "admin-a" }));
      await erasedUsers.markErased({ userId: "erased" });

      await organizations.recordAdminFact(fact({ adminUserId: "erased", at: 2_000 }));
      await organizations.recordAdminFact(fact({ adminUserId: "admin-b", at: 1_500 }));

      await expect(organizations.findOrganization({ organizationId: "org-1" })).resolves.toEqual([
        expect.objectContaining({ adminUserId: null }),
      ]);
    });
  });
});
