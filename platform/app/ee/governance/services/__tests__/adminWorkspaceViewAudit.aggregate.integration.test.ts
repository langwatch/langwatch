/**
 * @vitest-environment node
 *
 * ADR-144 decision 9: a read of an aggregate project is audited through the
 * same admin workspace view row as a personal or team drill-in, with its own
 * kind and the aggregate as the target. The personal and team kinds stay as
 * they were (their own suite, `adminWorkspaceViewAudit.service.integration
 * .test.ts`, is untouched); this suite pins what the new kind adds.
 *
 * Spec: specs/governance/aggregate-project.feature, section G.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project } from "~/generated/prisma/client";
import {
  type AggregateFixture,
  seedAggregateOrganization,
} from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { prisma } from "~/server/db";
import {
  ADMIN_WORKSPACE_VIEW_ACTION,
  ADMIN_WORKSPACE_VIEW_DEDUP_MS,
  AdminWorkspaceViewAuditService,
} from "../adminWorkspaceViewAudit.service";
import type { GovernanceOcsfEventsClickHouseRepository } from "../governanceOcsfEvents.clickhouse.repository";

let fixture: AggregateFixture;
let foreign: AggregateFixture;
let aggregate: Project;

/** A clock the test moves by hand, so the window is crossed without a wait. */
let nowMs = Date.now();
const ocsf = {
  insertEvent: vi.fn(async () => undefined),
} as unknown as GovernanceOcsfEventsClickHouseRepository;
const service = AdminWorkspaceViewAuditService.create({
  prisma,
  ocsfRepository: ocsf,
  now: () => new Date(nowMs),
});

const rowsOf = ({
  userId,
  targetKind,
}: {
  userId: string;
  targetKind: string;
}) =>
  prisma.auditLog.findMany({
    where: { userId, action: ADMIN_WORKSPACE_VIEW_ACTION, targetKind },
  });

beforeAll(async () => {
  fixture = await seedAggregateOrganization(prisma, { label: "awva-agg" });
  foreign = await seedAggregateOrganization(prisma, { label: "awva-foreign" });
  aggregate = await fixture.makeAggregate("company-view");
});

afterAll(async () => {
  await fixture?.cleanup();
  await foreign?.cleanup();
});

describe("AdminWorkspaceViewAuditService, aggregate kind", () => {
  describe("when an admin on the aggregate's own team reads it", () => {
    it("writes one row of kind aggregate naming the aggregate and nothing else", async () => {
      const result = await service.recordView({
        actorUserId: fixture.admin.id,
        organizationId: fixture.organizationId,
        kind: "aggregate",
        targetProjectId: aggregate.id,
      });

      expect(result.recorded).toBe(true);
      const [row, ...more] = await rowsOf({
        userId: fixture.admin.id,
        targetKind: "aggregate_project",
      });
      expect(more).toEqual([]);
      expect(row).toMatchObject({
        organizationId: fixture.organizationId,
        targetId: aggregate.id,
        metadata: { kind: "aggregate", workspaceLabel: aggregate.name },
      });
      expect(ocsf.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: aggregate.id,
          sourceType: "aggregate_project",
        }),
      );
    });
  });

  describe("when the same admin reads it again inside the window", () => {
    it("writes no second row", async () => {
      nowMs += ADMIN_WORKSPACE_VIEW_DEDUP_MS - 1_000;
      const result = await service.recordView({
        actorUserId: fixture.admin.id,
        organizationId: fixture.organizationId,
        kind: "aggregate",
        targetProjectId: aggregate.id,
      });

      expect(result.recorded).toBe(false);
      expect(
        await rowsOf({
          userId: fixture.admin.id,
          targetKind: "aggregate_project",
        }),
      ).toHaveLength(1);
    });
  });

  describe("when the same admin reads it once the window has passed", () => {
    it("writes a second row", async () => {
      nowMs += ADMIN_WORKSPACE_VIEW_DEDUP_MS + 1_000;
      const result = await service.recordView({
        actorUserId: fixture.admin.id,
        organizationId: fixture.organizationId,
        kind: "aggregate",
        targetProjectId: aggregate.id,
      });

      expect(result.recorded).toBe(true);
      expect(
        await rowsOf({
          userId: fixture.admin.id,
          targetKind: "aggregate_project",
        }),
      ).toHaveLength(2);
    });
  });

  describe("when the target is not an aggregate of the caller's organisation", () => {
    it("writes nothing for a missing, a plain or a foreign project", async () => {
      const foreignAggregate = await foreign.makeAggregate("elsewhere");
      const targets = [
        `project-missing-${fixture.ns}`,
        fixture.shared.id,
        foreignAggregate.id,
      ];

      for (const targetProjectId of targets) {
        const result = await service.recordView({
          actorUserId: fixture.member.id,
          organizationId: fixture.organizationId,
          kind: "aggregate",
          targetProjectId,
        });
        expect(result).toEqual({ recorded: false, auditLogId: null });
      }
      expect(
        await prisma.auditLog.count({ where: { userId: fixture.member.id } }),
      ).toBe(0);
    });
  });

  describe("when an admin opens another user's personal workspace", () => {
    it("writes a row of kind personal and none of kind aggregate", async () => {
      const personalTeamId = fixture.personal.seller.teamId;
      const result = await service.recordView({
        actorUserId: fixture.developer.id,
        organizationId: fixture.organizationId,
        kind: "personal",
        targetTeamId: personalTeamId,
      });

      expect(result.recorded).toBe(true);
      expect(
        await rowsOf({
          userId: fixture.developer.id,
          targetKind: "personal_workspace",
        }),
      ).toEqual([expect.objectContaining({ targetId: personalTeamId })]);
      expect(
        await rowsOf({
          userId: fixture.developer.id,
          targetKind: "aggregate_project",
        }),
      ).toEqual([]);
    });
  });
});
