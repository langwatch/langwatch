/**
 * @vitest-environment node
 * Real Postgres + real internal auth route. Expiry date read at resolve time, own rejection code, stored stops still win over it. Spec: specs/ai-gateway/virtual-key-lifecycle.feature
 */

import { type Instant, nowInstant, toDate } from "@langwatch/time";
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
const ORG_ID = `org-vkex-${suffix}`;
const TEAM_ID = `team-vkex-${suffix}`;
const PROJECT_ID = `proj-vkex-${suffix}`;
const USER_ID = `usr-vkex-${suffix}`;
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
let app: ReturnType<typeof mountGatewayInternalRest>;

function buildApp(): void {
  const projects = new SuiteProjectService();
  service = createVirtualKeyServiceForTest(prisma, projects);
  const jwtAdapter = GatewayJwtAdapter.create({ secret: SECRET });
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

const DAY_MS = 24 * 60 * 60 * 1000;

async function resolveCode(secret: string): Promise<{ status: number; code: string | null }> {
  const res = await app.fetch(signedResolveKey(secret));
  const body = (await res.json()) as { error?: { code?: string } };
  return { status: res.status, code: body.error?.code ?? null };
}

describe.skipIf(!databaseUrl)("virtual key expiry (real PG + internal route)", () => {
  beforeAll(async () => {
    buildApp();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `VKEX Org ${suffix}`, slug: `vkex-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `VKEX Team ${suffix}`,
        slug: `vkex-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `VKEX Project ${suffix}`,
        slug: `vkex-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `vkex-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vkex.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
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
      expiresAt: expiresAt ?? null,
    });
  }

  /** Writes a date the service would refuse, which is how a key that has
   *  already run out is set up without waiting for one to. */
  async function forceExpiry(id: string, expiresAt: Instant | null) {
    await prisma.virtualKey.update({
      where: { id },
      data: { expiresAt: expiresAt ? toDate(expiresAt) : null },
    });
  }

  describe("when the date has already passed", () => {
    /** @scenario "An expired key is rejected with its own error code" */
    it("rejects an expired key with the expiry code, not revoked or disabled", async () => {
      const { virtualKey, secret } = await mintKey({ name: "ran-out" });
      await forceExpiry(virtualKey.id, nowInstant().subtract({ milliseconds: 60_000 }));

      expect(await resolveCode(secret)).toEqual({
        status: 403,
        code: "virtual_key_expired",
      });
    });
  });

  describe("when the date is still ahead", () => {
    /** @scenario "A key whose expiration date is still ahead serves normally" */
    it("resolves a key whose date has not arrived yet", async () => {
      const { secret } = await mintKey({
        name: "still-good",
        expiresAt: nowInstant().add({ milliseconds: DAY_MS }),
      });

      const res = await app.fetch(signedResolveKey(secret));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { jwt: string };
      expect(body.jwt).toBeTruthy();
    });
  });

  describe("when the date on an expired key is moved forward", () => {
    /** @scenario "Extending the date puts an expired key back in service" */
    it("serves the same secret again once the date is moved forward", async () => {
      const { virtualKey, secret } = await mintKey({ name: "extend-me" });
      await forceExpiry(virtualKey.id, nowInstant().subtract({ milliseconds: 60_000 }));
      expect((await resolveCode(secret)).code).toBe("virtual_key_expired");

      await service.update({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        expiresAt: nowInstant().add({ milliseconds: DAY_MS }),
      });

      expect((await app.fetch(signedResolveKey(secret))).status).toBe(200);
    });
  });

  describe("when the date on an expired key is cleared", () => {
    /** @scenario "Clearing the expiration date makes the key permanent again" */
    it("serves forever once the date is cleared", async () => {
      const { virtualKey, secret } = await mintKey({
        name: "clear-me",
        expiresAt: nowInstant().add({ milliseconds: DAY_MS }),
      });
      await forceExpiry(virtualKey.id, nowInstant().subtract({ milliseconds: 60_000 }));
      expect((await resolveCode(secret)).code).toBe("virtual_key_expired");

      await service.update({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        expiresAt: null,
      });

      const stored = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: virtualKey.id },
      });
      expect(stored.expiresAt).toBeNull();
      expect((await app.fetch(signedResolveKey(secret))).status).toBe(200);
    });
  });

  describe("when a stored stop is applied on top of an expired key", () => {
    /** @scenario "Expiry leaves disable and revoke exactly as they were" */
    it("keeps the stored status, and reports the stored stop first", async () => {
      const { virtualKey, secret } = await mintKey({ name: "still-active" });
      await forceExpiry(virtualKey.id, nowInstant().subtract({ milliseconds: 60_000 }));

      const expired = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: virtualKey.id },
      });
      expect(expired.status).toBe("ACTIVE");

      await service.disable({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });
      expect((await resolveCode(secret)).code).toBe("virtual_key_disabled");

      await service.enable({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });
      expect((await resolveCode(secret)).code).toBe("virtual_key_expired");

      await service.revoke({
        id: virtualKey.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });
      expect((await resolveCode(secret)).code).toBe("virtual_key_revoked");
    });
  });
});
