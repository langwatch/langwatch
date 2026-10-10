// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi, StoredAggregateProject } from "@langwatch/project-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { AggregateReconcileLockRepository } from "../../repositories/aggregate-reconcile-lock.repository.ts";
import {
  AGGREGATE_ARCHIVED,
  AGGREGATE_RULE_NO_LONGER_MATCHES,
  AggregateReconcilerService,
} from "../aggregate-reconciler.service.ts";

const ORG = "org_1";
const AGG = "project_agg";
const NOW = "2026-10-09T03:17:00Z";
const ACTOR = { type: "system", id: SYSTEM_ACTORS.aggregateReconciler };

const allPersonal = (): StoredAggregateProject => ({
  id: AGG,
  organizationId: ORG,
  archived: false,
  rule: { kind: "all-personal" },
});

function setup({
  aggregate = allPersonal(),
  desired = [],
  held = [],
  refused = [],
  departmentMembers = [{ userId: "u_owner", departmentId: null }],
  liveAggregateIds = [AGG],
}: {
  aggregate?: StoredAggregateProject | null;
  desired?: string[];
  held?: string[];
  refused?: string[];
  departmentMembers?: {
    userId: string;
    departmentId: string | null;
    disabledAt?: Instant | null;
  }[];
  liveAggregateIds?: string[];
}) {
  const projects = {
    findAggregate: vi.fn<ProjectApi["findAggregate"]>(async () => (aggregate ? [aggregate] : [])),
    findLiveAggregateIds: vi.fn<ProjectApi["findLiveAggregateIds"]>(async () => liveAggregateIds),
    findAllLiveAggregates: vi.fn<ProjectApi["findAllLiveAggregates"]>(async () => []),
    findPersonalProjectIds: vi.fn<ProjectApi["findPersonalProjectIds"]>(async () => desired),
    findReadableProjectIds: vi.fn<ProjectApi["findReadableProjectIds"]>(async () => desired),
  };
  const grants = {
    findLiveSharedProjectGrants: vi.fn<AuthzApi["findLiveSharedProjectGrants"]>(async () =>
      held.map((memberProjectId) => ({ memberProjectId, grantId: `grant_${memberProjectId}` })),
    ),
    attachSharedProjectGrant: vi.fn<AuthzApi["attachSharedProjectGrant"]>(
      async ({ memberProjectId }) => {
        if (refused.includes(memberProjectId)) throw new Error("refused");
        return { grantId: `grant_${memberProjectId}`, wasAttached: true };
      },
    ),
    awaitSharedProjectGrants: vi.fn<AuthzApi["awaitSharedProjectGrants"]>(async () => undefined),
    revokeSharedProjectGrants: vi.fn<AuthzApi["revokeSharedProjectGrants"]>(
      async ({ memberProjectIds }) => (memberProjectIds ?? held).map((id) => `grant_${id}`),
    ),
  };
  const organizations = {
    findMembersWithDepartments: vi.fn<OrganizationApi["findMembersWithDepartments"]>(async () =>
      departmentMembers.map((member) => ({
        disabledAt: null,
        ...member,
        user: { name: null, email: null },
      })),
    ),
  };
  const lock: AggregateReconcileLockRepository = {
    withAggregateLock: ({ reconcile }) => reconcile(),
  };
  const reconciler = AggregateReconcilerService.create({
    lock,
    projects,
    organizations,
    grants,
    now: () => Temporal.Instant.from(NOW),
  });
  return { reconciler, projects, grants, organizations };
}

describe("AggregateReconcilerService", () => {
  describe("given an aggregate whose rule wants two members and holds none", () => {
    it("attaches one trace read per member from now on, and waits once for both", async () => {
      const { reconciler, grants } = setup({ desired: ["p_b", "p_a"] });

      const result = await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(result).toEqual({ attached: ["p_a", "p_b"], revoked: [], unchanged: [], failed: [] });
      expect(grants.attachSharedProjectGrant).toHaveBeenCalledWith({
        organizationId: ORG,
        readerProjectId: AGG,
        memberProjectId: "p_a",
        condition: { type: "trace", from: NOW },
        actor: ACTOR,
        awaitProjection: false,
      });
      expect(grants.awaitSharedProjectGrants).toHaveBeenCalledTimes(1);
      expect(grants.awaitSharedProjectGrants).toHaveBeenCalledWith({
        organizationId: ORG,
        grantIds: ["grant_p_a", "grant_p_b"],
      });
    });
  });

  describe("given an aggregate holding a member the rule no longer wants", () => {
    it("revokes that member with the rule-no-longer-matches reason and keeps the rest", async () => {
      const { reconciler, grants } = setup({ desired: ["p_a"], held: ["p_a", "p_gone"] });

      const result = await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(result).toEqual({ attached: [], revoked: ["p_gone"], unchanged: ["p_a"], failed: [] });
      expect(grants.revokeSharedProjectGrants).toHaveBeenCalledWith({
        organizationId: ORG,
        readerProjectId: AGG,
        memberProjectIds: ["p_gone"],
        actor: ACTOR,
        reason: AGGREGATE_RULE_NO_LONGER_MATCHES,
      });
    });
  });

  describe("when one member's attach is refused", () => {
    it("attaches the others, still revokes, and lists the refused one", async () => {
      const { reconciler, grants } = setup({
        desired: ["p_a", "p_b", "p_c"],
        held: ["p_gone"],
        refused: ["p_b"],
      });

      const result = await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(result).toEqual({
        attached: ["p_a", "p_c"],
        revoked: ["p_gone"],
        unchanged: [],
        failed: ["p_b"],
      });
      expect(grants.awaitSharedProjectGrants).toHaveBeenCalledWith({
        organizationId: ORG,
        grantIds: ["grant_p_a", "grant_p_c"],
      });
    });
  });

  describe("given an aggregate whose members are current", () => {
    it("attaches nothing and revokes nothing", async () => {
      const { reconciler, grants } = setup({ desired: ["p_a"], held: ["p_a"] });

      const result = await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(result.unchanged).toEqual(["p_a"]);
      expect(grants.attachSharedProjectGrant).not.toHaveBeenCalled();
      expect(grants.revokeSharedProjectGrants).not.toHaveBeenCalled();
    });
  });

  describe("given an aggregate whose stored rule does not parse", () => {
    it("reconciles nothing, not even revoking what it holds", async () => {
      const { reconciler, grants } = setup({
        aggregate: { ...allPersonal(), rule: null },
        held: ["p_a"],
      });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(grants.findLiveSharedProjectGrants).not.toHaveBeenCalled();
      expect(grants.revokeSharedProjectGrants).not.toHaveBeenCalled();
    });
  });

  describe("given an id that is not an aggregate", () => {
    it("reconciles nothing", async () => {
      const { reconciler, grants } = setup({ aggregate: null });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(grants.findLiveSharedProjectGrants).not.toHaveBeenCalled();
    });
  });

  describe("given an archived aggregate that still holds shared reads", () => {
    it("revokes every read with the archived reason and attaches nothing", async () => {
      const { reconciler, grants } = setup({
        aggregate: { ...allPersonal(), archived: true },
        desired: ["p_a"],
        held: ["p_a"],
      });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(grants.revokeSharedProjectGrants).toHaveBeenCalledWith({
        organizationId: ORG,
        readerProjectId: AGG,
        actor: ACTOR,
        reason: AGGREGATE_ARCHIVED,
      });
      expect(grants.attachSharedProjectGrant).not.toHaveBeenCalled();
    });
  });

  describe("when a rule's members are resolved", () => {
    it("never counts the aggregate as its own member", async () => {
      const { reconciler, grants } = setup({ desired: [AGG, "p_a"] });

      const result = await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(result.attached).toEqual(["p_a"]);
      expect(grants.attachSharedProjectGrant).toHaveBeenCalledTimes(1);
    });

    /** @scenario "The rule may be narrowed to one department" */
    it("reads only the department members' personal projects for a department rule", async () => {
      const { reconciler, projects } = setup({
        aggregate: {
          ...allPersonal(),
          rule: { kind: "personal-by-department", departmentId: "d1" },
        },
        departmentMembers: [
          { userId: "u1", departmentId: "d1" },
          { userId: "u2", departmentId: "d2" },
        ],
      });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(projects.findPersonalProjectIds).toHaveBeenCalledWith({
        organizationId: ORG,
        ownerUserIds: ["u1"],
      });
    });

    /** @scenario "A disabled member's personal project leaves every personal-project aggregate" */
    it("reads only active owners' personal projects for an all-personal rule", async () => {
      const { reconciler, projects } = setup({
        departmentMembers: [
          { userId: "u1", departmentId: null },
          {
            userId: "u2",
            departmentId: null,
            disabledAt: Temporal.Instant.from("2026-10-08T00:00:00Z"),
          },
        ],
      });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(projects.findPersonalProjectIds).toHaveBeenCalledWith({
        organizationId: ORG,
        ownerUserIds: ["u1"],
      });
    });

    it("leaves a disabled owner out of a department rule", async () => {
      const { reconciler, projects } = setup({
        aggregate: {
          ...allPersonal(),
          rule: { kind: "personal-by-department", departmentId: "d1" },
        },
        departmentMembers: [
          {
            userId: "u1",
            departmentId: "d1",
            disabledAt: Temporal.Instant.from("2026-10-08T00:00:00Z"),
          },
          { userId: "u2", departmentId: "d1" },
        ],
      });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(projects.findPersonalProjectIds).toHaveBeenCalledWith({
        organizationId: ORG,
        ownerUserIds: ["u2"],
      });
    });

    it("reads no projects for a department with no members", async () => {
      const { reconciler, projects } = setup({
        aggregate: {
          ...allPersonal(),
          rule: { kind: "personal-by-department", departmentId: "d9" },
        },
      });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(projects.findPersonalProjectIds).not.toHaveBeenCalled();
    });

    it("reads exactly the named projects, once each, for an explicit rule", async () => {
      const { reconciler, projects } = setup({
        aggregate: {
          ...allPersonal(),
          rule: { kind: "explicit", projectIds: ["p_a", "p_a", "p_b"] },
        },
      });

      await reconciler.reconcile({ aggregateProjectId: AGG });

      expect(projects.findReadableProjectIds).toHaveBeenCalledWith({
        organizationId: ORG,
        projectIds: ["p_a", "p_b"],
      });
    });
  });

  describe("when a project fact asks which aggregates to reconcile", () => {
    it("answers the organisation's live aggregates for an ordinary project", async () => {
      const { reconciler } = setup({ aggregate: null, liveAggregateIds: ["agg_1", "agg_2"] });

      expect(
        await reconciler.aggregatesToReconcile({ organizationId: ORG, projectId: "p_a" }),
      ).toEqual(["agg_1", "agg_2"]);
    });

    it("adds the project itself when it is an archived aggregate", async () => {
      const { reconciler } = setup({
        aggregate: { ...allPersonal(), archived: true },
        liveAggregateIds: ["agg_1"],
      });

      expect(
        await reconciler.aggregatesToReconcile({ organizationId: ORG, projectId: AGG }),
      ).toEqual(["agg_1", AGG]);
    });
  });
});
