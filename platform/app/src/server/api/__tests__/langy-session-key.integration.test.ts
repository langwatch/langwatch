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
import { batchProjectPermissions } from "~/server/api/rbac";
import { enforceApiKeyCeiling } from "~/server/api-key/auth-middleware";
import { LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { getApp } from "~/server/app-layer/app";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { prisma } from "../../db";
import {
  LANGY_CANDIDATE_PERMISSIONS,
  LangySessionKeyMetricsPort,
  LangySessionKeyService,
} from "@langwatch/langy-server";
import { LangySessionKeyScopeError } from "@langwatch/langy-server/ports/langy-turn-runtime";
import { LangySessionKeyRepository } from "@langwatch/trace-server";
import { experimentRoutePermissions } from "./helpers/langy-route-permissions";

wireDefaultTestApp();

class SessionKeyRepository extends LangySessionKeyRepository {
  async tryFindProjectScope(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { teamId: true, team: { select: { organizationId: true } } },
    });
    if (!project?.team) return null;
    return { teamId: project.teamId, organizationId: project.team.organizationId };
  }

  async tryFindById() {
    return null;
  }

  async revoke(): Promise<void> {}

  async reapExpired(): Promise<number> {
    return 0;
  }
}

class SessionKeyMetrics extends LangySessionKeyMetricsPort {
  record(): void {}
}

async function mintLangySessionApiKey(input: {
  session: { user: { id: string } };
  projectId: string;
  organizationId: string;
}): Promise<{ token: string; apiKeyId: string }> {
  const authz: AuthzService = Object.create(AuthzService.prototype);
  authz.effectivePermissions = async (args) => {
    if (args.scope.type !== "project") return [];
    return await batchProjectPermissions(
      { prisma, session: input.session },
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        teamId: args.scope.teamId,
        permissions: [...LANGY_CANDIDATE_PERMISSIONS],
      },
    );
  };

  return await LangySessionKeyService.create({
    repository: new SessionKeyRepository(),
    apiKeys: getApp().apiKeys,
    authz,
    metrics: new SessionKeyMetrics(),
  }).mint(input);
}

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
const EXPERIMENTER_ROLE_PERMISSIONS = ["experiments:view", "evaluations:manage"];

describe("Langy session key (caller-scoped)", () => {
  const ns = `langy-session-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let editorUserId: string;
  let experimenterUserId: string;
  let noAccessUserId: string;

  const sessionFor = (userId: string) => ({ user: { id: userId }, expires: "1" }) as any;

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
      ["user", { id: { in: [editorUserId, experimenterUserId, noAccessUserId] } }],
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
        const permissions = (customRole!.permissions as string[]).slice().sort();

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

        const app = getApp();
        const resolved = await app.apiKeys.apiKeyService.tryResolveToken({
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

      /** @scenario Langy can delete my work, because I can */
      it("reaches the destructive grains the caller's role grants", async () => {
        const { token } = await mintLangySessionApiKey({
          prisma,
          session: sessionFor(experimenterUserId),
          projectId,
          organizationId,
        });

        const app = getApp();
        const resolved = await app.apiKeys.apiKeyService.tryResolveToken({
          token,
          projectId,
        });

        // The human holds `evaluations:manage`, which implies the delete. The
        // key deliberately stops at view/create/update, so Langy cannot reach
        // the delete even though the person who asked for it could.
        for (const permission of ["evaluations:delete", "evaluations:manage"] as const) {
          await expect(
            enforceApiKeyCeiling({ resolved: resolved!, permission }),
            `Langy was refused ${permission}, which the caller's own role grants`,
          ).resolves.toBeUndefined();
        }
      });
    });
  });

  // The mirror of the capability test above, and the half that carries the
  // PR's whole safety argument: "the intersection is the real ceiling" is a
  // sentence until a caller WITHOUT the destructive grain is refused it at
  // the door. The editor's role has prompts view/create/update and no
  // delete/manage anywhere, so a passing refusal here demonstrates the clamp
  // rather than the candidate list simply never offering the grain.
  describe("given an org member whose role grants no destructive grain", () => {
    describe("when their Langy session key asks for one at the door", () => {
      /** @scenario Langy cannot delete my work when I cannot */
      it("is refused the delete its owner does not hold", async () => {
        const { token } = await mintLangySessionApiKey({
          prisma,
          session: sessionFor(editorUserId),
          projectId,
          organizationId,
        });

        const resolved = await TokenResolver.create(prisma).resolve({
          token,
          projectId,
        });
        expect(resolved).not.toBeNull();

        // The grain IS a candidate — the policy delegates prompts:delete —
        // so the only thing standing between this key and the delete is the
        // owner-ceiling re-check. That is the property under test.
        for (const permission of [
          "prompts:delete",
          "evaluations:delete",
        ] as const) {
          await expect(
            enforceApiKeyCeiling({ resolved: resolved!, permission }),
            `${permission} cleared the ceiling for a caller whose role does ` +
              `not hold it — the owner-intersection clamp is not holding`,
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
