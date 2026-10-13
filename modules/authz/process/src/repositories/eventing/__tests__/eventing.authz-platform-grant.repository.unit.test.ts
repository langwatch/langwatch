/**
 * @see specs/rbac/platform-operators.feature
 */
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { EventingAuthzPlatformGrantRepository } from "../eventing.authz-platform-grant.repository.ts";

const GRANTED_AT = new Date(0);

function database() {
  return {
    grant: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: "grant_alice", principalId: "user_alice", occurredAt: GRANTED_AT },
        ]),
      findFirst: vi.fn(),
    },
  };
}

describe("EventingAuthzPlatformGrantRepository", () => {
  describe("when the platform tier is read", () => {
    it("reads only live platform-operator grants to users under the platform tenant", async () => {
      const db = database();

      const grants = await EventingAuthzPlatformGrantRepository.create(db).findGrants({
        userId: "user_alice",
      });

      expect(grants[0]).toMatchObject({ grantId: "grant_alice", userId: "user_alice" });
      expect(grants[0]?.grantedAt.equals(fromDate(GRANTED_AT))).toBe(true);
      expect(db.grant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "platform",
            scopeType: "PLATFORM",
            scopeId: "platform",
            principalType: "USER",
            principalId: "user_alice",
            roleKey: "platform-operator",
            revokedAt: null,
          }),
        }),
      );
    });
  });
});
