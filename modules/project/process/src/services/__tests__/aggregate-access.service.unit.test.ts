/**
 * ADR-175 decision 5: which listing audiences see aggregates. The system sees
 * them, nobody never does, and a person only as an organisation admin.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AggregateAccessService } from "../aggregate-access.service.ts";

const ORGANIZATION_ID = "organization-acme";
const CREATED_AT = Temporal.Instant.from("2026-10-06T00:00:00.000Z");

/** A caller who is a member with this role, or who has no membership at all. */
type Seat = { role: string } | "absent";

function serviceFor(seat: Seat) {
  return AggregateAccessService.create({
    organizations: createApiFixture<OrganizationApi>({
      getMember: async ({ organizationId, userId }) => {
        if (seat === "absent") throw new MemberNotFoundError(userId);
        return {
          userId,
          organizationId,
          role: seat.role,
          disabledAt: null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          user: { id: userId, name: userId, email: `${userId}@acme.test` },
          teams: [],
        };
      },
    }),
    authorization: createApiFixture<AuthzApi>({ listBindingsForSynthesis: async () => [] }),
  });
}

describe("AggregateAccessService.listsAggregatesTo", () => {
  describe("given the system asks", () => {
    it("lists aggregates without looking anyone up", async () => {
      const service = serviceFor("absent");

      await expect(
        service.listsAggregatesTo({ organizationId: ORGANIZATION_ID, audience: "system" }),
      ).resolves.toBe(true);
    });
  });

  describe("given nobody asks", () => {
    it("lists no aggregates, even in an organisation of admins", async () => {
      const service = serviceFor({ role: "ADMIN" });

      await expect(
        service.listsAggregatesTo({ organizationId: ORGANIZATION_ID, audience: "nobody" }),
      ).resolves.toBe(false);
    });
  });

  describe("given a person asks", () => {
    it.each<{ caller: string; seat: Seat; lists: boolean }>([
      { caller: "an admin", seat: { role: "ADMIN" }, lists: true },
      { caller: "a member", seat: { role: "MEMBER" }, lists: false },
      { caller: "an outsider", seat: "absent", lists: false },
    ])("lists aggregates to $caller: $lists", async ({ seat, lists }) => {
      const service = serviceFor(seat);

      await expect(
        service.listsAggregatesTo({
          organizationId: ORGANIZATION_ID,
          audience: { userId: "user-1" },
        }),
      ).resolves.toBe(lists);
    });
  });
});
