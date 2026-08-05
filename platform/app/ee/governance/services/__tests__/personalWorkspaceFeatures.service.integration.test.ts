/**
 * @vitest-environment node
 *
 * Integration coverage for PersonalWorkspaceFeaturesService.
 *
 * Pins the storage contract end-to-end against a real Postgres:
 *   1. Default-empty JSON reads as all-false (no backfill needed for
 *      existing rows).
 *   2. enableAll flips the four bundle flags atomically + writes one
 *      AuditLog row per call with before/after JSON.
 *   3. disableAll inverts the bundle flags + writes the inverse audit
 *      row; data persists (the column is the only thing that flips —
 *      callers have to delete dataset/eval/etc rows separately).
 *   4. Owner mismatch + non-personal project both reject with
 *      NOT_FOUND-shaped errors so callers can't enumerate other
 *      users' personal projects by probing ids.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import {
  PERSONAL_FEATURES,
  PersonalProjectOwnerMismatchError,
  PersonalWorkspaceFeaturesService,
  personalFeatureEnabled,
  readPersonalFeatures,
} from "../personalWorkspaceFeatures.service";

const suffix = nanoid(8);
const ORG_ID = `org-pwf-${suffix}`;
const USER_ID = `usr-pwf-${suffix}`;
const OTHER_USER_ID = `usr-pwf-other-${suffix}`;
const PERSONAL_TEAM_ID = `team-pwf-${suffix}`;
const PERSONAL_PROJECT_ID = `proj-pwf-${suffix}`;
const SHARED_TEAM_ID = `team-pwf-shared-${suffix}`;
const SHARED_PROJECT_ID = `proj-pwf-shared-${suffix}`;

describe("PersonalWorkspaceFeaturesService", () => {
  const service = PersonalWorkspaceFeaturesService.create(prisma);

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `PWF ${suffix}`, slug: `pwf-${suffix}` },
    });
    await prisma.user.createMany({
      data: [
        { id: USER_ID, email: `pwf-${suffix}@example.com`, name: "Owner" },
        {
          id: OTHER_USER_ID,
          email: `pwf-o-${suffix}@example.com`,
          name: "Other",
        },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: USER_ID, role: "MEMBER" },
        { organizationId: ORG_ID, userId: OTHER_USER_ID, role: "MEMBER" },
      ],
    });
    await prisma.team.create({
      data: {
        id: PERSONAL_TEAM_ID,
        name: "Personal",
        slug: `pwf-personal-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PERSONAL_PROJECT_ID,
        name: "Personal Project",
        slug: `pwf-personal-${suffix}`,
        apiKey: `pwf-personal-${suffix}`,
        teamId: PERSONAL_TEAM_ID,
        language: "typescript",
        framework: "other",
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: SHARED_TEAM_ID,
        name: "Shared",
        slug: `pwf-shared-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: false,
      },
    });
    await prisma.project.create({
      data: {
        id: SHARED_PROJECT_ID,
        name: "Shared",
        slug: `pwf-shared-${suffix}`,
        apiKey: `pwf-shared-${suffix}`,
        teamId: SHARED_TEAM_ID,
        language: "typescript",
        framework: "other",
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog
      .deleteMany({ where: { projectId: { in: [PERSONAL_PROJECT_ID] } } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({
        where: { id: { in: [PERSONAL_PROJECT_ID, SHARED_PROJECT_ID] } },
      })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { id: { in: [PERSONAL_TEAM_ID, SHARED_TEAM_ID] } } })
      .catch(() => undefined);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => undefined);
  });

  describe("readPersonalFeatures (pure helper)", () => {
    it("defaults missing keys to false", () => {
      expect(readPersonalFeatures({})).toEqual({
        evaluations: false,
        datasets: false,
        annotations: false,
        automations: false,
      });
    });

    it("returns true only for explicit-true booleans (not truthy values)", () => {
      // String 'true' / 1 / 'yes' must not be treated as enabled —
      // anything that's not literal `true` defaults to false. Pins
      // the safe-by-default contract.
      expect(personalFeatureEnabled({ datasets: "true" }, "datasets")).toBe(
        false,
      );
      expect(personalFeatureEnabled({ datasets: 1 }, "datasets")).toBe(false);
      expect(personalFeatureEnabled({ datasets: true }, "datasets")).toBe(true);
    });

    it("safely handles null / non-object / undefined", () => {
      expect(personalFeatureEnabled(null, "datasets")).toBe(false);
      expect(personalFeatureEnabled(undefined, "datasets")).toBe(false);
      expect(personalFeatureEnabled("not-an-object", "datasets")).toBe(false);
    });
  });

  describe("get", () => {
    it("returns all-false on a freshly-provisioned personal project", async () => {
      const features = await service.get({
        projectId: PERSONAL_PROJECT_ID,
        callerUserId: USER_ID,
      });
      expect(features).toEqual({
        evaluations: false,
        datasets: false,
        annotations: false,
        automations: false,
      });
    });

    it("rejects a non-owner caller with NOT_FOUND-shaped error", async () => {
      await expect(
        service.get({
          projectId: PERSONAL_PROJECT_ID,
          callerUserId: OTHER_USER_ID,
        }),
      ).rejects.toBeInstanceOf(PersonalProjectOwnerMismatchError);
    });

    it("rejects a non-personal project even by its team's owner", async () => {
      await expect(
        service.get({
          projectId: SHARED_PROJECT_ID,
          callerUserId: USER_ID,
        }),
      ).rejects.toBeInstanceOf(PersonalProjectOwnerMismatchError);
    });
  });

  describe("enableAll / disableAll", () => {
    it("enableAll flips all four flags atomically + writes one audit row", async () => {
      const before = await service.get({
        projectId: PERSONAL_PROJECT_ID,
        callerUserId: USER_ID,
      });
      const result = await service.enableAll({
        projectId: PERSONAL_PROJECT_ID,
        callerUserId: USER_ID,
      });
      expect(result).toEqual({
        evaluations: true,
        datasets: true,
        annotations: true,
        automations: true,
      });
      // Persistence round-trip
      const reread = await service.get({
        projectId: PERSONAL_PROJECT_ID,
        callerUserId: USER_ID,
      });
      expect(reread).toEqual(result);

      const auditRows = await prisma.auditLog.findMany({
        where: {
          projectId: PERSONAL_PROJECT_ID,
          action: "personalWorkspaceFeatures.enableAll",
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(auditRows).toHaveLength(1);
      const row = auditRows[0]!;
      expect(row.userId).toBe(USER_ID);
      expect(row.organizationId).toBe(ORG_ID);
      expect(row.targetKind).toBe("project");
      expect(row.targetId).toBe(PERSONAL_PROJECT_ID);
      expect(row.before).toEqual(before);
      expect(row.after).toEqual(result);
    });

    it("disableAll flips all four back + writes inverse audit row", async () => {
      const result = await service.disableAll({
        projectId: PERSONAL_PROJECT_ID,
        callerUserId: USER_ID,
      });
      expect(result).toEqual({
        evaluations: false,
        datasets: false,
        annotations: false,
        automations: false,
      });
      const reread = await service.get({
        projectId: PERSONAL_PROJECT_ID,
        callerUserId: USER_ID,
      });
      expect(reread).toEqual(result);
      const auditRows = await prisma.auditLog.findMany({
        where: {
          projectId: PERSONAL_PROJECT_ID,
          action: "personalWorkspaceFeatures.disableAll",
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.before).toEqual({
        evaluations: true,
        datasets: true,
        annotations: true,
        automations: true,
      });
      expect(auditRows[0]!.after).toEqual(result);
    });

    it("enableAll rejects a non-owner caller — no flag change, no audit row", async () => {
      const auditCountBefore = await prisma.auditLog.count({
        where: { projectId: PERSONAL_PROJECT_ID },
      });
      await expect(
        service.enableAll({
          projectId: PERSONAL_PROJECT_ID,
          callerUserId: OTHER_USER_ID,
        }),
      ).rejects.toBeInstanceOf(PersonalProjectOwnerMismatchError);
      // Atomicity: failed call must not have written an audit row.
      const auditCountAfter = await prisma.auditLog.count({
        where: { projectId: PERSONAL_PROJECT_ID },
      });
      expect(auditCountAfter).toBe(auditCountBefore);
    });
  });

  describe("PERSONAL_FEATURES constant", () => {
    it("exposes the four feature keys in spec order", () => {
      expect(PERSONAL_FEATURES).toEqual([
        "evaluations",
        "datasets",
        "annotations",
        "automations",
      ]);
    });
  });
});
