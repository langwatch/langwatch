/**
 * @vitest-environment node
 *
 * Reading a correction through the tRPC router with a real privacy policy in the
 * database. A correction quotes the trace it corrects, so the read must hand a
 * restricted reviewer the structural edits and nothing else, while a reviewer
 * the policy allows gets the whole thing.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestProject } from "../../../../utils/testUtils";
import { globalForApp } from "../../../app-layer/app";
import type { AppDependencies } from "../../../app-layer/dependencies";
import { createTestApp } from "../../../app-layer/presets";
import { getDataPrivacyPolicyService } from "../../../data-privacy/dataPrivacyPolicy.service";
import { prisma } from "../../../db";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const NAMESPACE = "trace-edit-overlay-redaction";
const TRACE_ID = "trace-edit-overlay-redacted-read";

/**
 * The correction under test carries one edit of every kind: both trace content
 * fields, both span content fields, a corrected attribute set, and the
 * structural edits (a rename and a deletion) that must survive any gate.
 */
const patch: TraceEditOverlayPatch = {
  version: 1,
  trace: {
    input: { value: "corrected trace input" },
    output: { value: "corrected trace output" },
  },
  spans: [
    {
      spanId: "span-1",
      name: "renamed",
      input: { type: "text", value: "corrected span input" },
      output: { type: "text", value: "corrected span output" },
      params: { model: "gpt-5-mini" },
    },
  ],
  deletedSpanIds: ["span-2"],
};

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" },
    }),
  );

describe("Reading a trace correction", () => {
  const privacy = getDataPrivacyPolicyService();
  let previousApp: typeof globalForApp.__langwatch_app;
  let project: Project;
  let organizationId: string;
  let adminUserId: string;
  let memberUserId: string;

  beforeAll(async () => {
    // The trace summary is what decides whether the plan's visibility window
    // teases this trace's content; pinning it to "not teased" leaves the
    // privacy policy as the only thing separating the two readers.
    const base = createTestApp();
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = createTestApp({
      traces: {
        ...base.traces,
        summary: {
          getByTraceId: async () => ({ redactedByVisibilityWindow: false }),
        },
      } as unknown as AppDependencies["traces"],
    });

    project = await getTestProject(NAMESPACE);
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    organizationId = team.organizationId;

    const admin = await prisma.user.create({
      data: {
        name: "Correction Admin",
        email: `admin-${nanoid()}@example.com`,
      },
    });
    const member = await prisma.user.create({
      data: {
        name: "Correction Member",
        email: `member-${nanoid()}@example.com`,
      },
    });
    adminUserId = admin.id;
    memberUserId = member.id;

    await prisma.organizationUser.createMany({
      data: [
        {
          userId: adminUserId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: memberUserId,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      ],
    });
    await prisma.roleBinding.createMany({
      data: [
        {
          organizationId,
          userId: adminUserId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: project.teamId,
        },
        {
          organizationId,
          userId: memberUserId,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: project.teamId,
        },
      ],
    });

    await privacy.setForScope({
      scope: { scopeType: "PROJECT", scopeId: project.id },
      personalOnly: false,
      config: {
        categories: {
          input: { disposition: "restrict", audience: { admins: true } },
          output: { disposition: "restrict", audience: { admins: true } },
        },
      },
    });

    await callerFor(adminUserId).traceEditOverlay.upsert({
      projectId: project.id,
      traceId: TRACE_ID,
      patch,
    });
  });

  afterAll(async () => {
    // The swapped-in app is put back whatever cleanup reports, so a teardown
    // failure here cannot leak this suite's app into the ones that follow.
    try {
      // Setup can fail before it has created the rows these filters name.
      // Running them on an unassigned identifier throws a TypeError that would
      // replace the real setup failure in the report.
      if (!project || !organizationId || !adminUserId || !memberUserId) return;
      await cleanupTestRows(prisma, [
        ["traceEditOverlay", { projectId: project.id }],
        ["dataPrivacyPolicy", { organizationId }],
        ["roleBinding", { userId: { in: [adminUserId, memberUserId] }, organizationId }],
        [
          "organizationUser",
          { userId: { in: [adminUserId, memberUserId] }, organizationId },
        ],
        ["user", { id: { in: [adminUserId, memberUserId] } }],
      ]);
    } finally {
      globalForApp.__langwatch_app = previousApp;
    }
  });

  describe("given a reviewer the privacy policy keeps from captured content", () => {
    /** @scenario "A viewer who may not read captured content is handed only the structural edits" */
    it("hands over the structural edits and none of the corrected content", async () => {
      const overlay = await callerFor(memberUserId).traceEditOverlay.getByTraceId({
        projectId: project.id,
        traceId: TRACE_ID,
      });

      expect(overlay).not.toBeNull();
      expect(overlay!.patch.trace).toBeUndefined();
      expect(overlay!.patch.spans).toEqual([{ spanId: "span-1", name: "renamed" }]);
      expect(overlay!.patch.deletedSpanIds).toEqual(["span-2"]);
    });
  });

  describe("given a reviewer the privacy policy allows", () => {
    it("hands over the whole correction", async () => {
      const overlay = await callerFor(adminUserId).traceEditOverlay.getByTraceId({
        projectId: project.id,
        traceId: TRACE_ID,
      });

      expect(overlay!.patch).toEqual(patch);
    });
  });

  describe("when a restricted reviewer saves over someone else's correction", () => {
    const savedOverTraceId = "trace-edit-overlay-saved-over";

    /** @scenario "A reviewer who cannot read a field cannot remove its correction" */
    it("stores their rename and keeps the content they were never shown", async () => {
      const member = callerFor(memberUserId);
      await callerFor(adminUserId).traceEditOverlay.upsert({
        projectId: project.id,
        traceId: savedOverTraceId,
        patch,
      });

      // What the drawer does on save: read the correction back, then send it
      // with this reviewer's own edits on top of what they received.
      const asRead = await member.traceEditOverlay.getByTraceId({
        projectId: project.id,
        traceId: savedOverTraceId,
      });
      const saved = await member.traceEditOverlay.upsert({
        projectId: project.id,
        traceId: savedOverTraceId,
        patch: {
          ...asRead!.patch,
          spans: [{ spanId: "span-1", name: "renamed by the reviewer" }],
        },
      });

      // The answer respects the same gates the read does.
      expect(saved.patch.trace).toBeUndefined();
      expect(saved.patch.spans).toEqual([
        { spanId: "span-1", name: "renamed by the reviewer" },
      ]);

      const stored = await prisma.traceEditOverlay.findUniqueOrThrow({
        where: {
          projectId_traceId: {
            projectId: project.id,
            traceId: savedOverTraceId,
          },
        },
      });
      expect(stored.patch).toMatchObject({
        trace: {
          input: { value: "corrected trace input" },
          output: { value: "corrected trace output" },
        },
        spans: [
          {
            spanId: "span-1",
            name: "renamed by the reviewer",
            input: { type: "text", value: "corrected span input" },
            output: { type: "text", value: "corrected span output" },
            params: { model: "gpt-5-mini" },
          },
        ],
        deletedSpanIds: ["span-2"],
      });
    });

    it("still lets them remove the whole correction", async () => {
      const member = callerFor(memberUserId);
      await callerFor(adminUserId).traceEditOverlay.upsert({
        projectId: project.id,
        traceId: savedOverTraceId,
        patch,
      });

      await member.traceEditOverlay.delete({
        projectId: project.id,
        traceId: savedOverTraceId,
      });

      expect(
        await prisma.traceEditOverlay.findUnique({
          where: {
            projectId_traceId: {
              projectId: project.id,
              traceId: savedOverTraceId,
            },
          },
        }),
      ).toBeNull();
    });
  });
});
