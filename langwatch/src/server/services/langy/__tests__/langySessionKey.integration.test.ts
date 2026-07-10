/**
 * @vitest-environment node
 *
 * Integration tests for the per-session, caller-scoped Langy key (ADR-047).
 * Real database (Prisma), no mocks — the whole point is to prove that the key
 * ApiKeyService actually PERSISTS is clamped to the requesting user's own
 * permissions, so a Langy tool call can never exceed the human.
 *
 * Spec: specs/langy/langy-session-key.feature
 * Requires: PostgreSQL database (Prisma)
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LANGY_SESSION_API_KEY_NAME } from "~/server/api-key/reserved-names";
import { prisma } from "../../../db";
import {
  LangySessionKeyScopeError,
  mintLangySessionApiKey,
} from "../langyApiKey";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

// The limited role the "editor" user holds: prompts (view/create/update) plus
// datasets:view — deliberately NO triggers, NO datasets create/update, so the
// held-subset intersection is a strict, checkable slice of the candidate set.
const LIMITED_ROLE_PERMISSIONS = [
  "prompts:view",
  "prompts:create",
  "prompts:update",
  "datasets:view",
];

// Candidate ∩ held (with rbac hierarchy), sorted as ApiKeyService stores them.
const EXPECTED_HELD_SUBSET = [
  "datasets:view",
  "prompts:create",
  "prompts:update",
  "prompts:view",
];

describe.skipIf(isTestcontainersOnly)("Langy session key (caller-scoped)", () => {
  const ns = `langy-session-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let editorUserId: string;
  let noAccessUserId: string;

  const sessionFor = (userId: string) =>
    ({ user: { id: userId }, expires: "1" }) as any;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Langy Session Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: "Langy Session Team",
        slug: `--test-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: "Langy Session Project",
        slug: `--test-project-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;

    // Editor: an org member holding the limited role at the PROJECT scope via a
    // custom RoleBinding — the same resolution path hasProjectPermission and the
    // ApiKey ceiling both read.
    const editor = await prisma.user.create({
      data: { name: "Editor", email: `editor-${ns}@example.com` },
    });
    editorUserId = editor.id;
    await prisma.organizationUser.create({
      data: {
        userId: editorUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const customRole = await prisma.customRole.create({
      data: {
        name: `limited-${ns}`,
        organizationId,
        permissions: LIMITED_ROLE_PERMISSIONS,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId: editorUserId,
        role: TeamUserRole.CUSTOM,
        customRoleId: customRole.id,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: projectId,
      },
    });

    // No-access: an org member with NO project/team binding at all.
    const noAccess = await prisma.user.create({
      data: { name: "No Access", email: `noaccess-${ns}@example.com` },
    });
    noAccessUserId = noAccess.id;
    await prisma.organizationUser.create({
      data: {
        userId: noAccessUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
  });

  afterAll(async () => {
    // RoleBinding → ApiKey is onDelete: Restrict, so bindings must go first.
    await prisma.roleBinding
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.apiKey
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.customRole
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.project.deleteMany({ where: { teamId } }).catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => {});
    await prisma.user
      .deleteMany({ where: { id: { in: [editorUserId, noAccessUserId] } } })
      .catch(() => {});
    await prisma.organization
      .deleteMany({ where: { id: organizationId } })
      .catch(() => {});
  });

  async function findSessionKeys(userId: string) {
    return prisma.apiKey.findMany({
      where: {
        organizationId,
        userId,
        name: LANGY_SESSION_API_KEY_NAME,
        revokedAt: null,
      },
      include: { roleBindings: true },
    });
  }

  describe("given an org member who holds a limited role in the project", () => {
    describe("when a session key is minted for them", () => {
      it("persists a user-owned, restricted, project-bound, expiring key", async () => {
        const token = await mintLangySessionApiKey({
          prisma,
          session: sessionFor(editorUserId),
          projectId,
          organizationId,
        });
        expect(token).toMatch(/^sk-lw-/);

        const keys = await findSessionKeys(editorUserId);
        expect(keys).toHaveLength(1);
        const key = keys[0]!;

        expect(key.userId).toBe(editorUserId); // owned by the caller
        expect(key.permissionMode).toBe("restricted");
        expect(key.expiresAt).toBeInstanceOf(Date);
        expect(key.expiresAt!.getTime()).toBeGreaterThan(Date.now());

        expect(key.roleBindings).toHaveLength(1);
        const binding = key.roleBindings[0]!;
        expect(binding.scopeType).toBe(RoleBindingScopeType.PROJECT);
        expect(binding.scopeId).toBe(projectId);
        expect(binding.role).toBe(TeamUserRole.CUSTOM);
        expect(binding.customRoleId).toBeTruthy();
      });

      it("clamps the key's permissions to exactly what the caller holds", async () => {
        const keys = await findSessionKeys(editorUserId);
        const binding = keys[0]!.roleBindings[0]!;

        const customRole = await prisma.customRole.findUnique({
          where: { id: binding.customRoleId! },
        });
        const permissions = (customRole!.permissions as string[]).slice().sort();

        // Exactly the held subset — nothing the human can't already do.
        expect(permissions).toEqual(EXPECTED_HELD_SUBSET);
        // The caller can't create triggers, so the key can't either — even
        // though the old shared service key could.
        expect(permissions).not.toContain("triggers:create");
      });
    });
  });

  describe("given an org member who holds no permissions in the project", () => {
    describe("when a session key is minted for them", () => {
      it("refuses with LangySessionKeyScopeError and persists no key", async () => {
        await expect(
          mintLangySessionApiKey({
            prisma,
            session: sessionFor(noAccessUserId),
            projectId,
            organizationId,
          }),
        ).rejects.toBeInstanceOf(LangySessionKeyScopeError);

        expect(await findSessionKeys(noAccessUserId)).toHaveLength(0);
      });
    });
  });
});
