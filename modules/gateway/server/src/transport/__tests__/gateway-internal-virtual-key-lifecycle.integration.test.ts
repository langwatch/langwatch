/**
 * @vitest-environment node
 * Real Postgres + real internal auth route. Reversible disable/enable: the state machine (grace preservation, revoke terminality) and the distinct rejection a disabled key's traffic gets. Spec: specs/ai-gateway/virtual-key-lifecycle.feature
 */

import { type Instant, nowInstant } from "@langwatch/time";
import jsonwebtoken from "jsonwebtoken";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";

import { GatewayJwtAdapter } from "../../adapters/jwt.gateway-token.adapter.ts";
import { TestProjectApi } from "../../__tests__/support/test-project-api.ts";
import { VirtualKeyService } from "../../services/virtual-key.service.ts";

import { PostgresVirtualKeyAdapter } from "../../testing.ts";
import {
  mountGatewayInternalRest,
  signedGatewayRequest,
} from "./support/gateway-internal-rest.harness.ts";

const { createVirtualKeyServiceForTest } = PostgresVirtualKeyAdapter;
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG_ID = `org-vklc-${suffix}`;
const TEAM_ID = `team-vklc-${suffix}`;
const PROJECT_ID = `proj-vklc-${suffix}`;
const USER_ID = `usr-vklc-${suffix}`;
// Sequential-hex HMAC fixture for the signed-route test, not a credential;
// allowlisted by path in .gitleaks.toml.
const SECRET = "0123456789abcdef0123456789abcdef";

/** The three project reads this suite's subjects make, answered from its own rows. */
class SuiteProjectService extends TestProjectApi {
  override async findTraceDestination(
    projectId: string,
  ): ReturnType<ProjectApi["findTraceDestination"]> {
    return await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true, apiKey: true, archivedAt: true },
    });
  }

  override async resolveTraceDestination(
    input: Parameters<ProjectApi["resolveTraceDestination"]>[0],
  ): ReturnType<ProjectApi["resolveTraceDestination"]> {
    const projectId = input.traceProjectId ?? input.projectScopeIds[0];
    if (!projectId) return { outcome: "no_destination" };
    const project = await this.findTraceDestination(projectId);
    return project ? { outcome: "resolved", project } : { outcome: "unknown" };
  }
}

let service: VirtualKeyService;
let jwtAdapter: GatewayJwtAdapter;
let app: ReturnType<typeof mountGatewayInternalRest>;

function buildApp(): void {
  const projects = new SuiteProjectService();
  service = createVirtualKeyServiceForTest(prisma, projects);
  jwtAdapter = GatewayJwtAdapter.create({ secret: SECRET });
  app = mountGatewayInternalRest(
    { virtualKeys: service, projects, jwt: jwtAdapter, budgetSpend: undefined },
    { secret: SECRET },
  );
}

function signedResolveKey(keyPresented: string): Request {
  return signedGatewayRequest({
    method: "POST",
    path: "/api/internal/gateway/resolve-key",
    body: { key_presented: keyPresented },
    secret: SECRET,
  });
}

describe.skipIf(!databaseUrl)("virtual key disable and enable (real PG + internal route)", () => {
  beforeAll(async () => {
    buildApp();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `VKLC Org ${suffix}`, slug: `vklc-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `VKLC Team ${suffix}`,
        slug: `vklc-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `VKLC Project ${suffix}`,
        slug: `vklc-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `vklc-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vklc.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKeyScope.deleteMany({
      where: { virtualKey: { organizationId: ORG_ID } },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  }, 60_000);

  async function mintKey({ name, expiresAt }: { name: string; expiresAt?: Instant }) {
    return service.create({
      organizationId: ORG_ID,
      name: `${name}-${nanoid(6)}`,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      actorUserId: USER_ID,
      budget: { limitUsd: "100", window: "MONTH", onBreach: "BLOCK" },
      expiresAt: expiresAt ?? null,
    });
  }

  /** @scenario "Disable preserves everything and enable restores it exactly" */
  it("keeps rotation grace and budgets across a disable and enable round trip", async () => {
    const { virtualKey } = await mintKey({ name: "round-trip" });
    await service.rotate({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    const rotated = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(rotated.previousHashedSecret).not.toBeNull();
    expect(rotated.previousSecretValidUntil).not.toBeNull();

    await service.disable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      reason: "billing hold",
    });
    const disabled = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(disabled.status).toBe("DISABLED");
    expect(disabled.disabledReason).toBe("billing hold");
    expect(disabled.previousHashedSecret).toBe(rotated.previousHashedSecret);
    expect(disabled.previousSecretValidUntil?.getTime()).toBe(
      rotated.previousSecretValidUntil?.getTime(),
    );

    const budgetsWhileDisabled = await prisma.gatewayBudget.findMany({
      where: {
        organizationId: ORG_ID,
        scopeType: "VIRTUAL_KEY",
        scopeId: virtualKey.id,
        archivedAt: null,
      },
    });
    expect(budgetsWhileDisabled).toHaveLength(1);

    await service.enable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    const enabled = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(enabled.status).toBe("ACTIVE");
    expect(enabled.disabledAt).toBeNull();
    expect(enabled.disabledReason).toBeNull();
    expect(enabled.previousHashedSecret).toBe(rotated.previousHashedSecret);
  });

  /** @scenario "A disabled key is rejected with its own error code" */
  it("rejects a disabled key's traffic with the disabled code, not a bad credential", async () => {
    const { virtualKey, secret } = await mintKey({ name: "suspended-tenant" });
    await service.disable({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });

    const res = await app.fetch(signedResolveKey(secret));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("virtual_key_disabled");
  });

  describe("when the key expires before the ordinary TTL", () => {
    /** @scenario "The token ends when the key does" */
    it("ends the token at the key's expiration date and carries that date on it", async () => {
      const expiresAt = nowInstant().add({ milliseconds: 5 * 60 * 1000 });
      const { virtualKey, secret } = await mintKey({ name: "short-lived", expiresAt });
      const stored = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: virtualKey.id },
      });
      const keyExpiresAt = Math.floor(stored.expiresAt!.getTime() / 1000);

      const res = await app.fetch(signedResolveKey(secret));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { jwt: string };

      const decoded = jsonwebtoken.decode(body.jwt) as { exp: number };
      expect(decoded.exp).toBe(keyExpiresAt);
      expect(jwtAdapter.verify(body.jwt).vk_expires_at).toBe(keyExpiresAt);
    });
  });

  /** @scenario "Revocation is terminal in both directions" */
  it("refuses to disable or enable a revoked key", async () => {
    const { virtualKey } = await mintKey({ name: "terminal" });
    await service.revoke({
      id: virtualKey.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    await expect(
      service.disable({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      service.enable({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
