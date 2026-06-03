/**
 * @vitest-environment node
 *
 * Integration tests for the Langy model gate that the "Set up Langy" modal
 * exists to satisfy. Real database — no mocks.
 *
 * Langy's chat route (src/server/routes/langy.ts) calls getVercelAIModel,
 * which delegates to resolveModelForFeature("prompt.create_default"). When
 * nothing resolves for the DEFAULT role at any scope, that throws
 * ModelNotConfiguredError and the route answers HTTP 409 — the failure the
 * modal recovers from. The modal's "confirm a model" action persists the
 * chosen model as the project's DEFAULT-role default via
 * modelProvider.setRoleAssignmentForScope.
 *
 * These tests pin that exact contract end-to-end: gate throws with no
 * default, resolves after the modal's write, and the write is idempotent at
 * project scope.
 *
 * Spec: specs/assistant/langy-setup-modal.feature (the @integration scenarios)
 * Requires: PostgreSQL database (Prisma)
 */
import {
  OrganizationUserRole,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { resolveModelForFeature } from "~/server/modelProviders/resolveModelForFeature";
import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";

// The Langy chat route resolves with no explicit feature key, which defaults
// to "prompt.create_default" (DEFAULT role). Keep these in lockstep with
// getVercelAIModel's default so the test guards the real gate.
const LANGY_GATE_FEATURE_KEY = "prompt.create_default";

// describe.skipIf(isTestcontainersOnly): the testcontainers run sets
// TEST_CLICKHOUSE_URL and is reserved for ClickHouse-backed suites. This is a
// Postgres-only suite, so it must run when that var is ABSENT. If you see this
// suite skipped, you ran it in the wrong mode — unset TEST_CLICKHOUSE_URL.
const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)("Langy model gate (Set up Langy modal)", () => {
  const testNamespace = `langy-gate-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let userId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Langy Gate Org", slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: "Langy Gate Team",
        slug: `--test-team-${testNamespace}`,
        organizationId,
      },
    });
    teamId = team.id;

    const user = await prisma.user.create({
      data: { name: "Langy Gate User", email: `${testNamespace}@example.com` },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
    });
    await prisma.teamUser.create({
      data: { userId, teamId, role: TeamUserRole.ADMIN },
    });
  });

  afterAll(async () => {
    const projects = await prisma.project.findMany({
      where: { teamId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    // Default-model configs are attached to scopes (project/team/org) via a
    // join table; delete the configs first so their scope rows cascade.
    await prisma.modelDefaultConfig
      .deleteMany({
        where: {
          scopes: {
            some: {
              OR: [
                { scopeType: "ORGANIZATION", scopeId: organizationId },
                { scopeType: "TEAM", scopeId: teamId },
                ...projectIds.map((id) => ({
                  scopeType: "PROJECT" as const,
                  scopeId: id,
                })),
              ],
            },
          },
        },
      })
      .catch(() => {});
    await prisma.roleBinding.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.apiKey.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.project.deleteMany({ where: { teamId } }).catch(() => {});
    await prisma.teamUser.deleteMany({ where: { teamId } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => {});
    await prisma.organizationUser.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: organizationId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  function createCaller() {
    const ctx = createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" },
    });
    return appRouter.createCaller(ctx);
  }

  // A fresh project with no default-model config of its own. We do NOT mint a
  // Langy key here (that's PR1's concern); these tests are purely about the
  // model gate.
  async function createBareProject(name: string) {
    return prisma.project.create({
      data: {
        name,
        slug: `--gate-${testNamespace}-${nanoid(6)}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
  }

  // The modal's confirm action: persist the chosen model as the project's
  // DEFAULT-role default. We use saveDefaultModelsConfig (the same writer the
  // Model Providers settings drawer uses) rather than setRoleAssignmentForScope
  // so we exercise the production-proven, guard-safe path.
  function persistDefaultModel(projectId: string, model: string) {
    return createCaller().modelProvider.saveDefaultModelsConfig({
      config: { DEFAULT: model },
      scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
    });
  }

  it("fails the gate when the project has no default model configured", async () => {
    const project = await createBareProject("No Default");

    await expect(
      resolveModelForFeature(LANGY_GATE_FEATURE_KEY, {
        prisma,
        projectId: project.id,
      }),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError);
  });

  it("satisfies the gate after the modal persists the chosen model", async () => {
    const project = await createBareProject("Confirms Model");
    const chosen = "anthropic/claude-3-5-sonnet-20241022";

    await persistDefaultModel(project.id, chosen);

    const resolved = await resolveModelForFeature(LANGY_GATE_FEATURE_KEY, {
      prisma,
      projectId: project.id,
    });
    expect(resolved.model).toBe(chosen);
    expect(resolved.scope).toBe("project");
  });

  it("resolves to the latest choice when a different model is re-confirmed", async () => {
    const project = await createBareProject("Confirms Twice");
    const first = "anthropic/claude-3-5-sonnet-20241022";
    const second = "openai/gpt-4o";

    await persistDefaultModel(project.id, first);
    await persistDefaultModel(project.id, second);

    // The resolver picks the newest config at the project tier, so the most
    // recently confirmed model wins.
    const resolved = await resolveModelForFeature(LANGY_GATE_FEATURE_KEY, {
      prisma,
      projectId: project.id,
    });
    expect(resolved.model).toBe(second);
    expect(resolved.scope).toBe("project");
  });
});
