/**
 * AuthzApi.listBraidTargets through the composed app over memory twins: the braid dialog's
 * picker, decided for the viewer in one batch (ADR-183 §2).
 * @see modules/authz/specs/braids.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../../repositories/memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzReadRepository } from "../../repositories/memory/memory.authz-read.repository.ts";
import { MemoryAuthzRepositories } from "../../repositories/memory/memory.authz.repositories.ts";
import { AuthzModule, type AuthzSetup } from "../authz.app.ts";

const ORG = "org_acme";
const SPECIALISTS = "proj_specialists";
const ORCHESTRATOR = "proj_orchestrator";
const ROLLUP = "proj_rollup";
const ELSEWHERE = "proj_elsewhere";
const SPECIALISTS_TEAM = "team_specialists";
const ORCHESTRATOR_TEAM = "team_orchestrator";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function composeOver(memory: AuthzMemoryStore) {
  return AuthzModule.create({
    dependencies: {},
    config: {
      epochCacheEnabled: false,
      demoProjectId: undefined,
      demoProjectUserId: undefined,
      demoProjectSlug: undefined,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<AuthzSetup["secrets"]>(),
    repositories: {
      ...MemoryAuthzRepositories.create(),
      read: MemoryAuthzReadRepository.create({ memory }),
    },
  });
}

async function organisation() {
  const memory = AuthzMemoryStore.create();
  for (const [id, organizationId] of [
    [SPECIALISTS_TEAM, ORG],
    [ORCHESTRATOR_TEAM, ORG],
    ["team_elsewhere", "org_other"],
  ] as const) {
    memory.teams.push({ id, organizationId, name: id, isPersonal: false, ownerUserId: null });
  }
  for (const [id, teamId, kind] of [
    [SPECIALISTS, SPECIALISTS_TEAM, undefined],
    [ORCHESTRATOR, ORCHESTRATOR_TEAM, undefined],
    [ROLLUP, SPECIALISTS_TEAM, "aggregate"],
    [ELSEWHERE, "team_elsewhere", undefined],
  ] as const) {
    memory.projects.push({
      id,
      teamId,
      name: id,
      isPersonal: false,
      apiKey: `key_${id}`,
      createdAt: EPOCH,
      ...(kind ? { kind } : {}),
    });
  }
  const projection = MemoryAuthzGrantProjectionRepository.create({ memory });
  const seat = async (input: {
    userId: string;
    role: "ADMIN" | "MEMBER";
    scopeType: "ORGANIZATION" | "TEAM";
    scopeId: string;
  }) => {
    memory.memberships.set(memory.membershipKey(ORG, input.userId), {
      role: input.role,
      disabled: false,
      membershipStamp: `stamp_${input.userId}`,
      pendingSsoGrantId: null,
      createdAt: EPOCH,
    });
    await projection.append({
      kind: "grant.upsert",
      row: {
        id: `grant_${input.userId}`,
        organizationId: ORG,
        principalType: "USER",
        principalId: input.userId,
        legacyRole: null,
        source: "grants-service",
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: null,
        maxViews: null,
        occurredAt: EPOCH,
        roleKey: "admin",
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
    });
  };
  await seat({ userId: "user_ana", role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG });
  await seat({ userId: "user_tom", role: "MEMBER", scopeType: "TEAM", scopeId: SPECIALISTS_TEAM });
  return memory;
}

const EVERY_PROJECT = [SPECIALISTS, ORCHESTRATOR, ROLLUP, ELSEWHERE, "proj_gone"];

describe("AuthzApi.listBraidTargets", () => {
  describe("when an organisation admin asks", () => {
    /** @scenario "The picker decides every listed project for the viewer at once" */
    it("offers the readable plain projects and refuses the braid's own project and aggregates", async () => {
      const app = composeOver(await organisation());

      await expect(
        app.listBraidTargets({
          projectId: SPECIALISTS,
          projectIds: EVERY_PROJECT,
          caller: { type: "user", id: "user_ana" },
        }),
      ).resolves.toEqual([
        { projectId: SPECIALISTS, selectable: false, reason: "this_project" },
        { projectId: ORCHESTRATOR, selectable: true },
        { projectId: ROLLUP, selectable: false, reason: "aggregate" },
      ]);
    });
  });

  describe("when a team admin who cannot read the other team's traces asks", () => {
    /** @scenario "Projects whose traces the viewer cannot read are left out" */
    it("leaves out the projects they cannot read", async () => {
      const app = composeOver(await organisation());

      await expect(
        app.listBraidTargets({
          projectId: SPECIALISTS,
          projectIds: EVERY_PROJECT,
          caller: { type: "user", id: "user_tom" },
        }),
      ).resolves.toEqual([{ projectId: SPECIALISTS, selectable: false, reason: "this_project" }]);
    });
  });

  describe("when the braid's own project is unknown", () => {
    it("offers nothing", async () => {
      const app = composeOver(await organisation());

      await expect(
        app.listBraidTargets({
          projectId: "proj_gone",
          projectIds: EVERY_PROJECT,
          caller: { type: "user", id: "user_ana" },
        }),
      ).resolves.toEqual([]);
    });
  });
});
