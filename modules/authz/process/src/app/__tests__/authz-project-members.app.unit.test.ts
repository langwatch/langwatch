/**
 * AuthzApi.countProjectMembersHolding through the composed app over memory twins: the braid
 * dialog's "<n> people in <reader> will see these spans" (ADR-185 §7).
 * @see modules/authz/specs/braids.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../../repositories/memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzReadRepository } from "../../repositories/memory/memory.authz-read.repository.ts";
import { MemoryAuthzRepositories } from "../../repositories/memory/memory.authz.repositories.ts";
import { PROJECT_MEMBERS_DECIDED_LIMIT } from "../../services/authz-project-members.service.ts";
import { AuthzModule, type AuthzSetup } from "../authz.app.ts";

const ORG = "org_acme";
const READER = "proj_orchestrator";
const READER_TEAM = "team_orchestrator";
const OTHER_TEAM = "team_specialists";
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

function organisation() {
  const memory = AuthzMemoryStore.create();
  for (const id of [READER_TEAM, OTHER_TEAM]) {
    memory.teams.push({ id, organizationId: ORG, name: id, isPersonal: false, ownerUserId: null });
  }
  memory.projects.push({
    id: READER,
    teamId: READER_TEAM,
    name: "orchestrator",
    isPersonal: false,
    apiKey: "key_orchestrator",
    createdAt: EPOCH,
  });
  const projection = MemoryAuthzGrantProjectionRepository.create({ memory });
  const seat = async (input: {
    userId: string;
    role: "ADMIN" | "MEMBER";
    disabled?: boolean;
    grant?: { roleKey: string; scopeType: "ORGANIZATION" | "TEAM"; scopeId: string };
  }) => {
    memory.memberships.set(memory.membershipKey(ORG, input.userId), {
      role: input.role,
      disabled: input.disabled ?? false,
      membershipStamp: `stamp_${input.userId}`,
      pendingSsoGrantId: null,
      createdAt: EPOCH,
    });
    if (!input.grant) return;
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
        ...input.grant,
      },
    });
  };
  return { memory, seat };
}

describe("AuthzApi.countProjectMembersHolding", () => {
  describe("when the reader's team, an admin and other members hold different grants", () => {
    /** @scenario "The people who will see braided spans are the reader's members who can read its traces" */
    it("counts the active members holding traces:view at the reader, exactly", async () => {
      const { memory, seat } = organisation();
      await seat({
        userId: "user_ana",
        role: "ADMIN",
        grant: { roleKey: "admin", scopeType: "ORGANIZATION", scopeId: ORG },
      });
      await seat({
        userId: "user_tom",
        role: "MEMBER",
        grant: { roleKey: "member", scopeType: "TEAM", scopeId: READER_TEAM },
      });
      await seat({
        userId: "user_sam",
        role: "MEMBER",
        grant: { roleKey: "member", scopeType: "TEAM", scopeId: OTHER_TEAM },
      });
      await seat({
        userId: "user_dis",
        role: "MEMBER",
        disabled: true,
        grant: { roleKey: "member", scopeType: "TEAM", scopeId: READER_TEAM },
      });

      await expect(
        composeOver(memory).countProjectMembersHolding({
          projectId: READER,
          permission: "traces:view",
        }),
      ).resolves.toEqual({ count: 2, exact: true });
    });
  });

  describe("when the project is unknown", () => {
    it("counts nobody", async () => {
      const { memory } = organisation();

      await expect(
        composeOver(memory).countProjectMembersHolding({
          projectId: "proj_gone",
          permission: "traces:view",
        }),
      ).resolves.toEqual({ count: 0, exact: true });
    });
  });

  describe("when the organisation has more active members than one count decides", () => {
    /** @scenario "In a large organisation the number of people is a floor" */
    it("counts the members it decided and says the count is not exact", async () => {
      const { memory, seat } = organisation();
      const grant = { roleKey: "member", scopeType: "TEAM", scopeId: READER_TEAM } as const;
      for (let index = 0; index <= PROJECT_MEMBERS_DECIDED_LIMIT; index++) {
        await seat({ userId: `user_${String(index).padStart(4, "0")}`, role: "MEMBER", grant });
      }

      await expect(
        composeOver(memory).countProjectMembersHolding({
          projectId: READER,
          permission: "traces:view",
        }),
      ).resolves.toEqual({ count: PROJECT_MEMBERS_DECIDED_LIMIT, exact: false });
    });
  });
});
