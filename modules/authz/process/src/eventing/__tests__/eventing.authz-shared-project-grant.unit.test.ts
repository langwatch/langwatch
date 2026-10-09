import { GrantValidationError } from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { ACTOR, harness, ORG_ID } from "./support/eventing.authz-ledger-fork.harness.ts";

/**
 * ADR-177 block A: the ledger writes a shared project read only when both projects sit in the
 * organization, and dedupes by pair so a reconciler can run twice.
 * @see specs/governance/aggregate-project.feature
 */

const READER = "proj_aggregate";
const MEMBER = "proj_member";
const CONDITION = { type: "trace", from: "2026-10-01T00:00:00.000Z" } as const;

function lineageOf(organizations: Record<string, string>) {
  return {
    findProjectLineage: async ({ projectId }: { projectId: string }) => {
      const organizationId = organizations[projectId];
      return organizationId === undefined ? null : { teamId: "team_1", organizationId };
    },
  };
}

const bothInOrg = lineageOf({ [READER]: ORG_ID, [MEMBER]: ORG_ID });

function attachInput(memberProjectId = MEMBER) {
  return {
    organizationId: ORG_ID,
    readerProjectId: READER,
    memberProjectId,
    condition: CONDITION,
    actor: ACTOR,
    awaitProjection: false,
  };
}

describe("attachSharedProjectGrant", () => {
  describe("when both projects sit in the organization", () => {
    /** @scenario "A project-reader grant from one project to another is accepted" */
    it("emits one project-reader attach carrying the condition", async () => {
      const { writer, sent } = harness({ lineage: bothInOrg });

      const outcome = await writer.attachSharedProjectGrant(attachInput());

      expect(outcome.wasAttached).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.data).toMatchObject({
        organizationId: ORG_ID,
        grant: {
          grantId: outcome.grantId,
          principal: { type: "project", id: READER },
          roleKey: "project-reader",
          scope: { type: "PROJECT", id: MEMBER },
          condition: CONDITION,
          source: "aggregate-reconciler",
        },
      });
    });

    it("returns the live grant that already exists instead of emitting a second one", async () => {
      const { writer, db, sent } = harness({ lineage: bothInOrg });
      db.grant.findMany.mockResolvedValueOnce([{ id: "grant_live", scopeId: MEMBER }]);

      const outcome = await writer.attachSharedProjectGrant(attachInput());

      expect(outcome).toEqual({ grantId: "grant_live", wasAttached: false });
      expect(sent).toHaveLength(0);
    });

    it("mints a fresh grant id for each attach, never one derived from the pair", async () => {
      const { writer, sent } = harness({ lineage: bothInOrg });

      const first = await writer.attachSharedProjectGrant(attachInput());
      const second = await writer.attachSharedProjectGrant(attachInput());

      expect(second.grantId).not.toBe(first.grantId);
      expect(sent[1]?.data).toMatchObject({ grant: { grantId: second.grantId } });
    });
  });

  describe("when the member project belongs to another organization", () => {
    /** @scenario "Only the project-reader shape lifts the foreign-project refusal" */
    it("refuses before anything is appended", async () => {
      const { writer, sent } = harness({
        lineage: lineageOf({ [READER]: ORG_ID, [MEMBER]: "org_other" }),
      });

      await expect(writer.attachSharedProjectGrant(attachInput())).rejects.toBeInstanceOf(
        GrantValidationError,
      );
      expect(sent).toHaveLength(0);
    });
  });

  describe("when a project is missing or names itself", () => {
    it("refuses an unknown member project", async () => {
      const { writer } = harness({ lineage: lineageOf({ [READER]: ORG_ID }) });

      await expect(writer.attachSharedProjectGrant(attachInput())).rejects.toBeInstanceOf(
        GrantValidationError,
      );
    });

    it("refuses a project reading itself", async () => {
      const { writer } = harness({ lineage: bothInOrg });

      await expect(writer.attachSharedProjectGrant(attachInput(READER))).rejects.toBeInstanceOf(
        GrantValidationError,
      );
    });
  });
});

describe("revokeSharedProjectGrants", () => {
  let fixture: ReturnType<typeof harness>;
  beforeEach(() => {
    fixture = harness({ lineage: bothInOrg });
  });

  describe("when the reader holds live shared reads", () => {
    it("revokes only the ones on the members named", async () => {
      fixture.db.grant.findMany.mockResolvedValueOnce([
        { id: "grant_a", scopeId: "proj_a" },
        { id: "grant_b", scopeId: "proj_b" },
      ]);

      const revoked = await fixture.writer.revokeSharedProjectGrants({
        organizationId: ORG_ID,
        readerProjectId: READER,
        memberProjectIds: ["proj_b"],
        actor: ACTOR,
      });

      expect(revoked).toEqual(["grant_b"]);
    });

    it("does nothing when no live shared read matches", async () => {
      const revoked = await fixture.writer.revokeSharedProjectGrants({
        organizationId: ORG_ID,
        readerProjectId: READER,
        actor: ACTOR,
      });

      expect(revoked).toEqual([]);
      expect(fixture.sent).toHaveLength(0);
    });
  });
});
