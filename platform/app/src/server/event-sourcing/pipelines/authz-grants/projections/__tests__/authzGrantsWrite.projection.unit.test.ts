/** @vitest-environment node */

/**
 * The write projection: one event in, one statement about one row out.
 */
import { describe, expect, it } from "vitest";
import {
  AuthzGrantsWriteProjection,
  type GrantProjectionWrite,
  type GrantProjectionWriteStore,
} from "../authzGrantsWrite.projection";
import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
} from "../../schemas/constants";

const store: GrantProjectionWriteStore = { append: async () => undefined };
const projection = new AuthzGrantsWriteProjection({ store });

const ACTOR = { type: "user", id: "user_admin" } as const;

function attachedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: GRANT_ATTACHED_EVENT_TYPE,
    tenantId: "org_acme",
    aggregateId: "grant_1",
    occurredAt: 1,
    data: {
      grantId: "grant_1",
      principal: { type: "user", id: "user_1" },
      roleKey: "custom:cr_ops",
      scope: { type: "TEAM", id: "team_1" },
      source: "genesis-import",
      actor: ACTOR,
      ...overrides,
    },
  } as never;
}

describe("AuthzGrantsWriteProjection", () => {
  describe("given a grant attached", () => {
    /** @scenario "A grant event writes one row and reads nothing" */
    it("takes the owning organization from the event's tenant", () => {
      const write = projection.mapAuthzGrantAttached(attachedEvent());

      expect(write).toMatchObject({
        kind: "grant.upsert",
        row: { id: "grant_1", organizationId: "org_acme" },
      });
    });
  });

  describe("when an imported binding is reassigned to another custom role", () => {
    /**
     * The compat row reads `role = legacyRole ?? "CUSTOM"`, so a legacyRole
     * left over from the import projected an adopted ADMIN binding as
     * role=ADMIN after it had been moved to a different custom role. The
     * legacy resolver's empty-permission-list fallback then answered "admin"
     * where the legacy row said "viewer".
     *
     * @scenario "Reassigning a grant's role clears the role it was imported with"
     */
    it("does not carry the imported role onto the reassignment", () => {
      const imported = projection.mapAuthzGrantAttached(
        attachedEvent({ legacyRole: "ADMIN" }),
      );
      expect(imported).toMatchObject({ row: { legacyRole: "ADMIN" } });

      const reassigned: GrantProjectionWrite =
        projection.mapAuthzGrantRoleChanged({
          type: GRANT_ROLE_CHANGED_EVENT_TYPE,
          tenantId: "org_acme",
          aggregateId: "grant_1",
          occurredAt: 2,
          data: {
            grantId: "grant_1",
            from: "custom:cr_ops",
            to: "custom:cr_sre",
            actor: ACTOR,
          },
        } as never);

      // The write names only the role; the store clears legacyRole when it
      // applies it, which is what the escalation turns on.
      expect(reassigned).toEqual({
        kind: "grant.setRole",
        grantId: "grant_1",
        roleKey: "custom:cr_sre",
        occurredAt: new Date(2),
      });
    });
  });
});
