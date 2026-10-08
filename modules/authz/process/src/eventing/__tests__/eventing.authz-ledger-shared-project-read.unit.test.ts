/**
 * ADR-175 block A: a shared project read is written by the ledger, which asks storage the one
 * question the wire cannot (both projects sit in the organisation) and dedupes by identity so
 * a reconciler can run twice.
 * @see specs/governance/aggregate-project.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACTOR, harness, ORG_ID } from "./support/eventing.authz-ledger-fork.harness.ts";

const READER = "proj_aggregate";
const MEMBER = "proj_member";
const CONDITION = { type: "trace", from: "2026-10-01T00:00:00.000Z" } as const;

type Harness = ReturnType<typeof harness>;

/** Seeds which organization each project sits in, as the project lineage read answers it. */
function seedLineage({
  db,
  rows,
}: {
  db: Harness["db"];
  rows: [projectId: string, organizationId: string][];
}): void {
  const byId = new Map(rows);
  db.project.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const organizationId = byId.get(where.id);
    return organizationId === undefined ? null : { team: { id: "team_1", organizationId } };
  });
}

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : error;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("attachSharedProjectGrant", () => {
  describe("when both projects sit in the organisation", () => {
    /** @scenario "A project-reader grant from one project to another is accepted" */
    it("emits one project-reader attach carrying the condition and bumps the epoch", async () => {
      const { writer, db, sent, epoch } = harness({});
      seedLineage({
        db,
        rows: [
          [READER, ORG_ID],
          [MEMBER, ORG_ID],
        ],
      });

      const outcome = await writer.attachSharedProjectGrant({
        organizationId: ORG_ID,
        readerProjectId: READER,
        memberProjectId: MEMBER,
        condition: CONDITION,
        actor: ACTOR,
        awaitProjection: false,
      });

      expect(outcome.wasAttached).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        verb: "attachGrant",
        data: {
          tenantId: ORG_ID,
          organizationId: ORG_ID,
          grant: {
            grantId: outcome.grantId,
            principal: { type: "project", id: READER },
            roleKey: "project-reader",
            scope: { type: "PROJECT", id: MEMBER },
            condition: CONDITION,
            source: "aggregate-reconciler",
            actor: ACTOR,
            occurredAtMs: 1_700_000_000_000,
          },
        },
      });
      expect(epoch.bump).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });

    it("returns the live grant that already exists instead of emitting a second one", async () => {
      const { writer, db, sent } = harness({});
      seedLineage({
        db,
        rows: [
          [READER, ORG_ID],
          [MEMBER, ORG_ID],
        ],
      });
      db.grant.findMany.mockResolvedValueOnce([{ id: "grant_existing", scopeId: MEMBER }]);

      const outcome = await writer.attachSharedProjectGrant({
        organizationId: ORG_ID,
        readerProjectId: READER,
        memberProjectId: MEMBER,
        condition: CONDITION,
        actor: ACTOR,
        awaitProjection: false,
      });

      expect(outcome).toEqual({ grantId: "grant_existing", wasAttached: false });
      expect(sent).toHaveLength(0);
      expect(db.grant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            principalType: "PROJECT",
            principalId: READER,
            scopeType: "PROJECT",
            scopeId: { in: [MEMBER] },
            roleKey: "project-reader",
            revokedAt: null,
          }),
        }),
      );
    });
  });

  describe("when the member project belongs to another organisation", () => {
    // The refusal across two organisations.
    /** @scenario "Only the project-reader shape lifts the foreign-project refusal" */
    it("refuses before anything is appended", async () => {
      const { writer, db, sent, epoch } = harness({});
      seedLineage({
        db,
        rows: [
          [READER, ORG_ID],
          [MEMBER, "org_other"],
        ],
      });

      expect(
        await codeOf(() =>
          writer.attachSharedProjectGrant({
            organizationId: ORG_ID,
            readerProjectId: READER,
            memberProjectId: MEMBER,
            condition: CONDITION,
            actor: ACTOR,
          }),
        ),
      ).toBe("grant_validation_failed");
      expect(sent).toHaveLength(0);
      expect(epoch.bump).not.toHaveBeenCalled();
    });
  });

  describe("when a project is missing or names itself", () => {
    it("refuses an unknown member project", async () => {
      const { writer, db, sent } = harness({});
      seedLineage({ db, rows: [[READER, ORG_ID]] });

      expect(
        await codeOf(() =>
          writer.attachSharedProjectGrant({
            organizationId: ORG_ID,
            readerProjectId: READER,
            memberProjectId: MEMBER,
            condition: CONDITION,
            actor: ACTOR,
          }),
        ),
      ).toBe("grant_validation_failed");
      expect(sent).toHaveLength(0);
    });

    it("refuses a project reading itself", async () => {
      const { writer, db, sent } = harness({});

      expect(
        await codeOf(() =>
          writer.attachSharedProjectGrant({
            organizationId: ORG_ID,
            readerProjectId: READER,
            memberProjectId: READER,
            condition: CONDITION,
            actor: ACTOR,
          }),
        ),
      ).toBe("grant_validation_failed");
      expect(db.project.findUnique).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });
  });
});

describe("revokeSharedProjectGrants", () => {
  describe("when the reader holds live shared reads", () => {
    it("revokes the ones on the members named, marking rather than deleting", async () => {
      const { writer, db, sent, epoch } = harness({});
      db.grant.findMany.mockResolvedValue([
        { id: "grant_a", scopeId: MEMBER },
        { id: "grant_b", scopeId: "proj_other" },
      ]);

      const revoked = await writer.revokeSharedProjectGrants({
        organizationId: ORG_ID,
        readerProjectId: READER,
        memberProjectIds: [MEMBER, "proj_other"],
        actor: ACTOR,
        reason: "rule-narrowed",
      });

      expect(revoked).toEqual(["grant_a", "grant_b"]);
      expect(db.grant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            principalType: "PROJECT",
            principalId: READER,
            scopeType: "PROJECT",
            roleKey: "project-reader",
            scopeId: { in: [MEMBER, "proj_other"] },
            revokedAt: null,
          }),
        }),
      );
      expect(sent.map((call) => call.verb)).toEqual(["revokeGrant", "revokeGrant"]);
      expect(db.grant.updateMany).toHaveBeenCalled();
      expect(db.grant.deleteMany).not.toHaveBeenCalled();
      expect(epoch.bump).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });

    it("does nothing when no live shared read matches", async () => {
      const { writer, sent } = harness({});

      expect(
        await writer.revokeSharedProjectGrants({
          organizationId: ORG_ID,
          readerProjectId: READER,
          actor: ACTOR,
        }),
      ).toEqual([]);
      expect(sent).toHaveLength(0);
    });
  });
});

describe("findLiveSharedProjectGrants", () => {
  it("lists the reader's live shared reads by member, ordered by member", async () => {
    const { writer, db } = harness({});
    db.grant.findMany.mockResolvedValue([
      { id: "grant_a", scopeId: "proj_a" },
      { id: "grant_b", scopeId: "proj_b" },
    ]);

    expect(
      await writer.findLiveSharedProjectGrants({ organizationId: ORG_ID, readerProjectId: READER }),
    ).toEqual([
      { grantId: "grant_a", memberProjectId: "proj_a" },
      { grantId: "grant_b", memberProjectId: "proj_b" },
    ]);
    expect(db.grant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { scopeId: "asc" } }),
    );
  });
});
