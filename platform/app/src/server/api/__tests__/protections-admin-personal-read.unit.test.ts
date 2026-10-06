import { beforeEach, describe, expect, it, vi } from "vitest";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { PLATFORM_DEFAULT_DATA_PRIVACY } from "~/server/data-privacy/dataPrivacy.types";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { getUserProtectionsForProject } from "../utils";

const recordView = vi.fn();

vi.mock("@ee/governance/services/adminWorkspaceViewAudit.service", () => ({
  AdminWorkspaceViewAuditService: {
    create: () => ({ recordView }),
  },
}));

vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeProjectPermission: vi.fn(),
}));

vi.mock("~/server/data-privacy/dataPrivacyPolicy.service", () => ({
  getDataPrivacyPolicyService: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({}),
  // Reached through the TtlCache these paths read; null keeps it in-memory.
  tryGetApp: () => null,
}));

const OWNER = "ariana";
const ADMIN = "carol";

type ScopedGrant = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  roleKey: string;
};

const mockPrisma = {
  project: { findUniqueOrThrow: vi.fn() },
  grant: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
} as unknown as Parameters<typeof getUserProtectionsForProject>[0]["prisma"];

const prisma = mockPrisma as unknown as {
  project: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  grant: { findMany: ReturnType<typeof vi.fn> };
  groupMembership: { findMany: ReturnType<typeof vi.fn> };
};

function givenProject({ isPersonal }: { isPersonal: boolean }) {
  prisma.project.findUniqueOrThrow.mockResolvedValue({
    teamId: "team-1",
    ownerUserId: isPersonal ? OWNER : null,
    team: { organizationId: "org-1", isPersonal },
  });
}

function givenGrants(grants: ScopedGrant[]) {
  prisma.grant.findMany.mockResolvedValue(
    grants.map((grant) => ({
      ...grant,
      principalType: "USER",
      principalId: null,
    })),
  );
}

function givenViewerGrants(userId: string, grants: ScopedGrant[]) {
  prisma.grant.findMany.mockResolvedValue(
    grants.map((grant) => ({
      ...grant,
      principalType: "USER",
      principalId: userId,
    })),
  );
}

const protectionsFor = (userId: string) =>
  getUserProtectionsForProject(
    { prisma: mockPrisma, session: { user: { id: userId } } as never },
    { projectId: "project-1" },
  );

describe("getUserProtectionsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordView.mockResolvedValue({ recorded: true, auditLogId: "audit-1" });
    vi.mocked(probeProjectPermission).mockResolvedValue(true);
    vi.mocked(getDataPrivacyPolicyService).mockReturnValue({
      getResolvedForProject: vi
        .fn()
        .mockResolvedValue(PLATFORM_DEFAULT_DATA_PRIVACY),
    } as unknown as ReturnType<typeof getDataPrivacyPolicyService>);
    prisma.groupMembership.findMany.mockResolvedValue([]);
    givenGrants([]);
  });

  describe("given another member's personal workspace", () => {
    beforeEach(() => givenProject({ isPersonal: true }));

    describe("when an admin reads it through their organization role alone", () => {
      beforeEach(() =>
        givenViewerGrants(ADMIN, [
          { scopeType: "ORGANIZATION", roleKey: "admin" },
        ]),
      );

      /** @scenario "An admin reading another member's personal workspace is recorded by the read itself" */
      it("records the read and shows the content", async () => {
        const result = await protectionsFor(ADMIN);

        expect(recordView).toHaveBeenCalledWith({
          actorUserId: ADMIN,
          organizationId: "org-1",
          targetTeamId: "team-1",
          kind: "personal",
        });
        expect(result.canSeeCapturedInput).toBe(true);
        expect(result.canSeeCapturedOutput).toBe(true);
      });

      /** @scenario "A read that cannot be recorded does not show the content" */
      it("hides the content when the record cannot be written", async () => {
        recordView.mockRejectedValue(new Error("audit store unavailable"));

        const result = await protectionsFor(ADMIN);

        expect(result.canSeeCapturedInput).toBe(false);
        expect(result.canSeeCapturedOutput).toBe(false);
      });
    });

    describe("when the owner reads it", () => {
      beforeEach(() => givenViewerGrants(OWNER, []));

      /** @scenario "The owner reading their own personal workspace is not recorded" */
      it("does not record the read and shows the content", async () => {
        const result = await protectionsFor(OWNER);

        expect(recordView).not.toHaveBeenCalled();
        expect(result.canSeeCapturedInput).toBe(true);
      });
    });

    describe("when someone with a role on the workspace reads it", () => {
      beforeEach(() =>
        givenViewerGrants("dave", [
          { scopeType: "PROJECT", roleKey: "viewer" },
        ]),
      );

      /** @scenario "Someone with a role on the workspace itself is not recorded" */
      it("does not record the read", async () => {
        await protectionsFor("dave");

        expect(recordView).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a team project", () => {
    beforeEach(() => givenProject({ isPersonal: false }));

    describe("when an admin reads it through their organization role alone", () => {
      beforeEach(() =>
        givenViewerGrants(ADMIN, [
          { scopeType: "ORGANIZATION", roleKey: "admin" },
        ]),
      );

      /** @scenario "Reading a team project is not recorded" */
      it("does not record the read and shows the content", async () => {
        const result = await protectionsFor(ADMIN);

        expect(recordView).not.toHaveBeenCalled();
        expect(result.canSeeCapturedInput).toBe(true);
      });
    });
  });
});
