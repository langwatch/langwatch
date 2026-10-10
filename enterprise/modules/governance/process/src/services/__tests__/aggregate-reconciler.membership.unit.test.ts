// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * ADR-177 block E end to end over stateful doubles: a fact or the sweep enqueues through the real
 * outbox, the real reconcile intent runs, and the ledger double keeps revoked rows as main does.
 * @see specs/governance/aggregate-project.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { JsonValue, ProcessStore } from "@langwatch/eventing";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { AggregateRule, ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  OutboxAggregateReconcile,
  runAggregateReconcile,
  runAggregateSweep,
} from "../../eventing/aggregate-reconcile.intent.ts";
import { aggregateReconcileIntentSchema } from "../../eventing/aggregate-reconcile.process.ts";
import {
  enqueueAffectedAggregates,
  enqueueChangedAggregate,
  enqueueMemberAggregates,
} from "../../eventing/aggregate-reconcile.subscriber.ts";
import { AggregateReconcilerService } from "../aggregate-reconciler.service.ts";

const ORG = "org_1";
const AGG = "agg_1";

type GrantRow = { id: string; memberProjectId: string; revokedAt: string | null };

/** One organisation: personal projects by owner, members by department, one aggregate. */
function world({ rule }: { rule: AggregateRule }) {
  const state = {
    rule,
    personal: new Map<string, string>(),
    departments: new Map<string, string | null>(),
    explicitReadable: new Set<string>(),
    rows: [] as GrantRow[],
  };
  const projects: Pick<
    ProjectApi,
    | "findAggregate"
    | "findLiveAggregateIds"
    | "findAllLiveAggregates"
    | "findPersonalProjectIds"
    | "findReadableProjectIds"
  > = {
    findAggregate: async ({ aggregateProjectId }) =>
      aggregateProjectId === AGG
        ? [{ id: AGG, organizationId: ORG, archived: false, rule: state.rule }]
        : [],
    findLiveAggregateIds: async () => [AGG],
    findAllLiveAggregates: async () => [{ id: AGG, organizationId: ORG }],
    findPersonalProjectIds: async ({ ownerUserIds }) =>
      [...state.personal]
        .filter(([, owner]) => ownerUserIds === undefined || ownerUserIds.includes(owner))
        .map(([projectId]) => projectId)
        .toSorted(),
    findReadableProjectIds: async ({ projectIds }) =>
      projectIds.filter((id) => state.explicitReadable.has(id)).toSorted(),
  };
  const organizations: Pick<OrganizationApi, "findMembersWithDepartments"> = {
    findMembersWithDepartments: async () =>
      [...state.departments].map(([userId, departmentId]) => ({
        userId,
        departmentId,
        disabledAt: null,
        user: { name: null, email: null },
      })),
  };
  const live = () => state.rows.filter((row) => row.revokedAt === null);
  const grants: Pick<
    AuthzApi,
    | "findLiveSharedProjectGrants"
    | "attachSharedProjectGrant"
    | "awaitSharedProjectGrants"
    | "revokeSharedProjectGrants"
  > = {
    findLiveSharedProjectGrants: async () =>
      live().map((row) => ({ memberProjectId: row.memberProjectId, grantId: row.id })),
    attachSharedProjectGrant: vi.fn<AuthzApi["attachSharedProjectGrant"]>(
      async ({ memberProjectId }) => {
        const held = live().find((row) => row.memberProjectId === memberProjectId);
        if (held) return { grantId: held.id, wasAttached: false };
        const row = { id: `grant_${state.rows.length}`, memberProjectId, revokedAt: null };
        state.rows.push(row);
        return { grantId: row.id, wasAttached: true };
      },
    ),
    awaitSharedProjectGrants: async () => undefined,
    revokeSharedProjectGrants: async ({ memberProjectIds }) =>
      live()
        .filter((row) => memberProjectIds?.includes(row.memberProjectId) ?? true)
        .map((row) => {
          row.revokedAt = "2026-10-10T00:00:00Z";
          return row.id;
        }),
  };
  const reconciler = AggregateReconcilerService.create({
    lock: { withAggregateLock: ({ reconcile }) => reconcile() },
    projects,
    organizations,
    grants,
    now: () => Temporal.Instant.from("2026-10-10T00:00:00Z"),
  });

  const queued: JsonValue[] = [];
  const appendIntents: ProcessStore["appendIntents"] = async ({ messages }) => {
    for (const message of messages) queued.push(message.payload);
    return { insertedMessageKeys: messages.map((m) => m.messageKey), duplicateMessageKeys: [] };
  };
  const outbox = OutboxAggregateReconcile.create({ appendIntents });
  const runReconcile = runAggregateReconcile(reconciler);
  /** What the worker does with the outbox: run each queued reconcile intent. */
  const drain = async () => {
    for (const payload of queued.splice(0)) {
      await runReconcile(aggregateReconcileIntentSchema.parse(payload), {
        processName: "aggregateProjectReconcile",
        projectId: ORG,
        processKey: `aggregate:${AGG}`,
        tenantId: ORG,
        messageKey: "reconcile",
        attempt: 1,
      });
    }
  };
  const liveMembers = () =>
    live()
      .map((row) => row.memberProjectId)
      .toSorted();
  return { state, reconciler, outbox, drain, liveMembers, grants };
}

describe("the reconciler keeps an aggregate's members current", () => {
  describe("given an aggregate project with the rule all personal projects", () => {
    describe("when a new member's personal project is created", () => {
      /** @scenario "A new personal project joins an all-personal aggregate on creation" */
      it("makes the new personal project a member of the aggregate", async () => {
        const { state, reconciler, outbox, drain, liveMembers } = world({
          rule: { kind: "all-personal" },
        });
        state.personal.set("p_ana", "u_ana");
        state.departments.set("u_ana", null);
        await reconciler.reconcile({ aggregateProjectId: AGG });
        expect(liveMembers()).toEqual(["p_ana"]);

        state.personal.set("p_newcomer", "u_newcomer");
        state.departments.set("u_newcomer", null);
        await enqueueAffectedAggregates({ reconciler, outbox, trigger: "project-created" })({
          projectId: "p_newcomer",
          organizationId: ORG,
          occurredAt: 1,
        });
        await drain();

        expect(liveMembers()).toEqual(["p_ana", "p_newcomer"]);
      });
    });

    describe("when the nightly sweep runs after a project was created while no trigger fired", () => {
      /** @scenario "A nightly sweep catches a missed trigger" */
      it("makes that personal project a member", async () => {
        const { state, reconciler, outbox, drain, liveMembers } = world({
          rule: { kind: "all-personal" },
        });
        state.personal.set("p_missed", "u_missed");
        state.departments.set("u_missed", null);

        await runAggregateSweep({
          reconciler,
          outbox,
          deleteDispatchedBefore: async () => 0,
          now: () => 1,
        })(
          { scheduledFor: 1 },
          {
            processName: "aggregateProjectReconcile",
            projectId: ORG,
            processKey: "sweep",
            tenantId: ORG,
            messageKey: "sweep:1",
            attempt: 1,
          },
        );
        await drain();

        expect(liveMembers()).toEqual(["p_missed"]);
      });
    });
  });

  describe("given an aggregate over Engineering's personal projects", () => {
    describe("when a member in Engineering is moved to Sales", () => {
      /** @scenario "A department move updates a by-department aggregate" */
      it("drops their personal project from the aggregate", async () => {
        const { state, reconciler, outbox, drain, liveMembers } = world({
          rule: { kind: "personal-by-department", departmentId: "engineering" },
        });
        state.personal.set("p_eng", "u_eng");
        state.personal.set("p_mover", "u_mover");
        state.departments.set("u_eng", "engineering");
        state.departments.set("u_mover", "engineering");
        await reconciler.reconcile({ aggregateProjectId: AGG });
        expect(liveMembers()).toEqual(["p_eng", "p_mover"]);

        state.departments.set("u_mover", "sales");
        await enqueueMemberAggregates({
          reconciler,
          outbox,
          trigger: "member-department-changed",
        })({ organizationId: ORG, userId: "u_mover", occurredAt: 2 });
        await drain();

        expect(liveMembers()).toEqual(["p_eng"]);
      });
    });
  });

  describe("given an aggregate over an explicit list of two projects", () => {
    describe("when the rule is edited to drop one", () => {
      /** @scenario "Removing a project from an explicit rule revokes its read" */
      it("revokes that project's read and keeps its row, marked revoked", async () => {
        const { state, reconciler, outbox, drain, liveMembers } = world({
          rule: { kind: "explicit", projectIds: ["p_a", "p_b"] },
        });
        state.explicitReadable.add("p_a").add("p_b");
        await reconciler.reconcile({ aggregateProjectId: AGG });
        const dropped = state.rows.find((row) => row.memberProjectId === "p_b");

        state.rule = { kind: "explicit", projectIds: ["p_a"] };
        await enqueueChangedAggregate({ outbox })({
          projectId: AGG,
          organizationId: ORG,
          occurredAt: 3,
        });
        await drain();

        expect(liveMembers()).toEqual(["p_a"]);
        expect(state.rows).toHaveLength(2);
        expect(state.rows.find((row) => row.id === dropped?.id)?.revokedAt).not.toBeNull();
      });
    });
  });

  describe("given an aggregate whose members are current", () => {
    describe("when the reconciler runs again", () => {
      /** @scenario "Reconciling twice changes nothing" */
      it("leaves the same rows with the same ids and writes no duplicate", async () => {
        const { state, reconciler, grants } = world({ rule: { kind: "all-personal" } });
        state.personal.set("p_a", "u_a").set("p_b", "u_b");
        state.departments.set("u_a", null).set("u_b", null);
        await reconciler.reconcile({ aggregateProjectId: AGG });
        const before = structuredClone(state.rows);

        const again = await reconciler.reconcile({ aggregateProjectId: AGG });

        expect(again).toEqual({ attached: [], revoked: [], unchanged: ["p_a", "p_b"], failed: [] });
        expect(state.rows).toEqual(before);
        expect(grants.attachSharedProjectGrant).toHaveBeenCalledTimes(2);
      });
    });
  });
});
