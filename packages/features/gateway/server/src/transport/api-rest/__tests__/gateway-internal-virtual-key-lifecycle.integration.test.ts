/**
 * @vitest-environment node
 *
 * Reversible virtual-key disable and enable against real Postgres and the
 * real internal auth route: the state machine (grace preservation, revoke
 * terminality) and the distinct rejection a disabled key's traffic gets.
 *
 * Spec: specs/ai-gateway/virtual-key-lifecycle.feature
 */

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
import type { ProjectService } from "@langwatch/project-contract";

import { GatewayJwtAdapter } from "../../../adapters/jwt.gateway-token.adapter";
import { TestProjectService } from "../../../services/__tests__/support/test-project-service";
import { VirtualKeyService } from "../../../services/virtual-key.service";
import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
  createGatewayInternalRestApp,
  type GatewayInternalRestPorts,
} from "../gateway-internal.api";
import { testRestSecurity } from "./support/rest-security.support";

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
class SuiteProjectService extends TestProjectService {
  override async tryGetTraceDestination(
    projectId: string,
  ): ReturnType<ProjectService["tryGetTraceDestination"]> {
    return await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true, apiKey: true, archivedAt: true },
    });
  }

  override async resolveTraceDestination(
    input: Parameters<ProjectService["resolveTraceDestination"]>[0],
  ): ReturnType<ProjectService["resolveTraceDestination"]> {
    const projectId = input.traceProjectId ?? input.projectScopeIds[0];
    if (!projectId) return { outcome: "no_destination" };
    const project = await this.tryGetTraceDestination(projectId);
    return project ? { outcome: "resolved", project } : { outcome: "unknown" };
  }
}

let service: VirtualKeyService;
let jwtAdapter: GatewayJwtAdapter;
let app: ReturnType<typeof createGatewayInternalRestApp>;

function buildApp(): void {
  const projects = new SuiteProjectService();
  service = VirtualKeyService.createForTest(prisma, projects);
  jwtAdapter = GatewayJwtAdapter.create({ secret: SECRET });
  const absent = () => {
    throw new Error("this route is not under test here");
  };
  const ports = {
    internalSecret: () => SECRET,
    virtualKeys: () => service,
    projects: () => projects,
    jwt: () => jwtAdapter,
    store: absent,
    changes: absent,
    config: absent,
    budgetSpend: () => undefined,
  } as unknown as GatewayInternalRestPorts;
  app = createGatewayInternalRestApp({ security: testRestSecurity(), ports });
}

function signedResolveKey(keyPresented: string): Request {
  const path = "/api/internal/gateway/resolve-key";
  const body = JSON.stringify({ key_presented: keyPresented });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeGatewaySignature(
    SECRET,
    buildGatewayCanonicalString({ method: "POST", path, timestamp, body }),
  );
  return new Request(`http://api.test${path}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
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

  async function mintKey({ name, expiresAt }: { name: string; expiresAt?: Date }) {
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
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
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
