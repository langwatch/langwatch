import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { EventingAuthzReadRepository } from "../repositories/eventing/eventing.authz-read.repository.ts";
import { AuthzCollectorService } from "../services/authz-collector.service.ts";

const ORG = "org-acme";

describe("AuthzCollectorService over the grants head", () => {
  describe("when a member has a live grant in the organization", () => {
    /** @scenario A grant collection reads live grant facts */
    it("collects that grant into the snapshot and reads no legacy binding table", async () => {
      const grantRead = vi
        .fn()
        .mockResolvedValue([
          { roleKey: "admin", scopeType: "PROJECT", scopeId: "chatbot", expiresAt: null },
        ]);
      const legacyBindingRead = vi.fn().mockResolvedValue([]);
      const collector = AuthzCollectorService.create({
        reader: EventingAuthzReadRepository.create(
          prismaDouble({
            organizationUser: {
              findFirst: vi.fn().mockResolvedValue({ role: "MEMBER", disabledAt: null }),
            },
            groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
            grant: { findMany: grantRead },
            roleBinding: { findMany: legacyBindingRead },
          }),
        ),
      });

      const snapshot = await collector.collectGrants({
        principal: { type: "user", id: "alice" },
        organizationId: ORG,
      });

      expect(snapshot.bindings).toEqual([
        { roleKey: "admin", scopeType: "PROJECT", scopeId: "chatbot", viaGroupId: null },
      ]);
      expect(grantRead).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG,
            principalType: "USER",
            principalId: "alice",
            revokedAt: null,
          }),
        }),
      );
      expect(legacyBindingRead).not.toHaveBeenCalled();
    });
  });
});
