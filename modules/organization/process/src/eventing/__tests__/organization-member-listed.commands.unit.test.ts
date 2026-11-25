/**
 * @vitest-environment node
 * Organization lists each existing active membership as its own fact, so a peer's member copy
 * can be rebuilt from organization's log.
 * Spec: modules/organization/specs/organization-service.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
  organizationMemberListedEventDataSchema,
} from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { RecordMemberListedCommand } from "../organization-lifecycle.commands.ts";

const JOINED_AT = Date.UTC(2025, 2, 1, 9);
const LISTED_AT = Date.UTC(2026, 10, 19, 12);
const LISTED = {
  tenantId: "org_acme",
  organizationId: "org_acme",
  userId: "user_ada",
  joinedAt: JOINED_AT,
  backfilled: true as const,
  occurredAt: LISTED_AT,
};

function record(occurredAt: number) {
  const [event] = new RecordMemberListedCommand().handle({
    tenantId: createTenantId("org_acme"),
    aggregateId: "org_acme",
    type: RecordMemberListedCommand.schema.type,
    data: { ...LISTED, occurredAt },
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("organization's member listed fact", () => {
  describe("when the schema reads a listed membership", () => {
    it("accepts the organization, the member, when it joined and the backfilled mark", () => {
      expect(organizationMemberListedEventDataSchema.parse(LISTED)).toEqual(LISTED);
    });

    it("refuses one with no join time, or one not marked backfilled", () => {
      expect(
        organizationMemberListedEventDataSchema.validate({ ...LISTED, joinedAt: undefined }),
      ).toBe(false);
      expect(
        organizationMemberListedEventDataSchema.validate({ ...LISTED, backfilled: false }),
      ).toBe(false);
    });
  });

  describe("when the listing step records a membership", () => {
    /** @scenario "Existing active members are listed as organization's facts by the member listing step" */
    it("records it on the organization, with when the membership was created, marked backfilled", () => {
      const event = record(LISTED_AT);

      expect(event.type).toBe(ORGANIZATION_MEMBER_LISTED_EVENT_TYPE);
      expect(event.aggregateType).toBe("organization");
      expect(event.aggregateId).toBe("org_acme");
      expect(event.occurredAt).toBe(LISTED_AT);
      expect(event.data).toMatchObject({
        organizationId: "org_acme",
        userId: "user_ada",
        joinedAt: JOINED_AT,
        backfilled: true,
      });
    });

    /** @scenario "Re-running the member listing step records nothing new" */
    it("keys it on the organization and the member alone, so a rerun collapses onto the first", () => {
      const first = record(LISTED_AT);
      const rerun = record(LISTED_AT + 60_000);

      expect(first.idempotencyKey).toBe("org_acme:user_ada:member_listed");
      expect(rerun.idempotencyKey).toBe(first.idempotencyKey);
    });
  });
});
