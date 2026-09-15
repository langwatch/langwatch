/**
 * @vitest-environment node
 * The session-policy contract, stated once and run against every backend the
 * package can reach. The memory twin runs always; a Postgres backend joins
 * the table when this package declares a datastore in its vitest config.
 */
import { describe, expect, it } from "vitest";
import type { OrganizationSessionPolicyRepository } from "../policy/session-policy.repository.ts";
import { MemoryOrganizationSessionPolicyRepository } from "../memory/memory.organization-session-policy.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => OrganizationSessionPolicyRepository }> = [
  { name: "memory", create: () => MemoryOrganizationSessionPolicyRepository.create() },
];

describe.each(backends)("given the $name session policy repository", ({ create }) => {
  describe("when no admin has capped the session", () => {
    it("answers the unbounded policy", async () => {
      await expect(create().find("org-1")).resolves.toEqual({ maxSessionDurationDays: 0 });
    });
  });

  describe("when an admin caps the session", () => {
    it("reads back the cap the admin set, on that organization only", async () => {
      const repository = create();

      await repository.setMaxDurationDays("org-1", 30);

      await expect(repository.find("org-1")).resolves.toEqual({ maxSessionDurationDays: 30 });
      await expect(repository.find("org-2")).resolves.toEqual({ maxSessionDurationDays: 0 });
    });
  });
});
