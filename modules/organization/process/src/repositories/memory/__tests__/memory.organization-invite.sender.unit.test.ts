import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationInviteRepository } from "../memory.organization-invite.repository.ts";
import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";

const write = {
  email: "sam@acme.test",
  inviteCode: "code-1",
  expiration: Temporal.Instant.from("2026-10-20T00:00:00Z"),
  organizationId: "org_1",
  teamIds: "",
  role: "DEVELOPER",
} as const;

describe("MemoryOrganizationInviteRepository sender", () => {
  describe("when a pending invitation is written with a sender", () => {
    it("stores the sender, and a write without one stores none", async () => {
      const repository = MemoryOrganizationInviteRepository.create({
        memory: MemoryOrganizationDatabase.create(),
      });

      const sent = await repository.createPendingInvite({ ...write, requestedBy: "user_ana" });
      const unsent = await repository.createPendingInvite({ ...write, email: "kim@acme.test" });

      expect(sent.requestedBy).toBe("user_ana");
      expect(unsent.requestedBy).toBeNull();
    });
  });
});
