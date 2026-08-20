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

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { Permission } from "~/server/api/rbac";
import { enforceApiKeyCeiling } from "~/server/api-key/auth-middleware";
import { LANGY_SESSION_API_KEY_NAME } from "~/server/api-key/reserved-names";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { prisma } from "../../../db";
import {
  LangySessionKeyScopeError,
  mintLangySessionApiKey,
} from "../langyApiKey";
import { experimentRoutePermissions } from "./helpers/routePermissions";

// This suite only needs Postgres — every harness (CI's testcontainers, native
// local services) provides that, so it runs unconditionally. It used to carry
// an `isTestcontainersOnly`/`TEST_CLICKHOUSE_URL` skip guard, which permanently
// skipped it EVERYWHERE: CI always sets TEST_CLICKHOUSE_URL for the
// ClickHouse-dependent suites sharing the run. The file had gone stale unnoticed
// as a result. Do not add the guard back — see PR #5988.

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

// A member who can work with experiments the ordinary way: the dedicated
// experiments read every project role holds, plus management of the
// evaluations family that actually executes a run.
const EXPERIMENTER_ROLE_PERMISSIONS = [
  "experiments:view",
  "evaluations:manage",
];

describe("Langy session key (caller-scoped)", () => {
  const ns = `langy-session-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let editorUserId: string;
  let experimenterUserId: string;
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

    // Experimenter: holds the experiment surface the ordinary way, so the
    // intersection is decided by Langy's candidate list rather than by a gap
    // in the human's own role.
    const experimenter = await prisma.user.create({
      data: { name: "Experimenter", email: `experimenter-${ns}@example.com` },
    });
    experimenterUserId = experimenter.id;
    await prisma.organizationUser.create({
      data: {
        userId: experimenterUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const experimenterRole = await prisma.customRole.create({
      data: {
        name: `experimenter-${ns}`,
        organizationId,
        permissions: EXPERIMENTER_ROLE_PERMISSIONS,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId: experimenterUserId,
        role: TeamUserRole.CUSTOM,
        customRoleId: experimenterRole.id,
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
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["apiKey", { organizationId }],
      ["customRole", { organizationId }],
      ["project", { teamId }],
      ["organizationUser", { organizationId }],
      ["team", { id: teamId }],
      [
        "user",
        { id: { in: [editorUserId, experimenterUserId, noAccessUserId] } },
      ],
      ["organization", { id: organizationId }],
    ]);
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
        const { token } = await mintLangySessionApiKey({
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
        const permissions = (customRole!.permissions as string[])
          .slice()
          .sort();

        // Exactly the held subset — nothing the human can't already do.
        expect(permissions).toEqual(EXPECTED_HELD_SUBSET);
        // The caller can't create triggers, so the key can't either — even
        // though the old shared service key could.
        expect(permissions).not.toContain("triggers:create");
      });
    });
  });

  // The reported failure: `langwatch experiment list` came back
  // `api_key_permission_denied` for `experiments:view` against a key minted for
  // a user who could see the project's experiments perfectly well in the UI.
  // Asserting the candidate list alone would not have caught it — the refusal
  // happens at the door, where the route's grain meets the key's ceiling — so
  // this drives the real path: mint the key, resolve the token the CLI would
  // send, and run the same ceiling check the route runs.
  describe("given an org member who can work with experiments in the project", () => {
    describe("when their Langy session key is checked against the experiment routes", () => {
      it("clears the ceiling for every permission the experiment surface asks for", async () => {
        const { token } = await mintLangySessionApiKey({
          prisma,
          session: sessionFor(experimenterUserId),
          projectId,
          organizationId,
        });

        const resolved = await TokenResolver.create(prisma).resolve({
          token,
          projectId,
        });
        expect(resolved).not.toBeNull();

        const required = experimentRoutePermissions();
        // Guard the guard: an empty list would make the loop below vacuous.
        expect(required).toContain("experiments:view");

        for (const permission of required) {
          await expect(
            enforceApiKeyCeiling({
              resolved: resolved!,
              permission: permission as Permission,
            }),
            `Langy was refused ${permission}, which an /api/experiments route ` +
              `demands. Either the candidate list is missing it, or the route ` +
              `asks for a grain no least-privilege key can hold`,
          ).resolves.toBeUndefined();
        }
      });

      it("is still refused the destructive grains the caller's role does grant", async () => {
        const { token } = await mintLangySessionApiKey({
          prisma,
          session: sessionFor(experimenterUserId),
          projectId,
          organizationId,
        });

        const resolved = await TokenResolver.create(prisma).resolve({
          token,
          projectId,
        });

        // The human holds `evaluations:manage`, which implies the delete. The
        // key deliberately stops at view/create/update, so Langy cannot reach
        // the delete even though the person who asked for it could.
        for (const permission of [
          "evaluations:delete",
          "evaluations:manage",
        ] as const) {
          await expect(
            enforceApiKeyCeiling({ resolved: resolved!, permission }),
          ).rejects.toThrow();
        }
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
