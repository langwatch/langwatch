/**
 * @vitest-environment node
 *
 * GET /api/internal/gateway/config/:vk_id, the route the Go gateway calls on
 * every bundle cache miss, against the real family and real Postgres.
 *
 * The materialiser reads `vk.routingPolicy` off whatever the caller included,
 * so a materialiser test that does its own include cannot catch the route
 * forgetting one: the bundle just comes back with an empty alias map and empty
 * deny lists, and the gateway silently stops resolving aliases and enforcing
 * model policy. This exercises the route's own query.
 *
 * Spec: specs/ai-gateway/provider-routing.feature
 *       specs/ai-gateway/governance/routing-policy-aliases-and-rules.feature
 *       specs/ai-gateway/auth-cache.feature
 */
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

import { PrismaGatewayAdapter } from "../../../adapters/prisma.gateway.adapter";
import { PrismaGatewayInternalStoreAdapter } from "../../../adapters/prisma.gateway-internal-store.adapter";
import type { GatewayModelProviderCredentialsPort } from "../../../ports/gateway-model-provider-credentials.port";
import { GatewayConfigMaterialiser } from "../../../services/gateway-config-materialisation.service";
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
const ORG_ID = `org-cfgroute-${suffix}`;
const TEAM_ID = `team-cfgroute-${suffix}`;
const PROJECT_ID = `proj-cfgroute-${suffix}`;
const USER_ID = `usr-cfgroute-${suffix}`;
const RP_ID = `rp-cfgroute-${suffix}`;
const VK_ID = `vk-cfgroute-${suffix}`;
const VK_EXPIRING_ID = `vk-cfgexp-${suffix}`;
const MP_ID = `mp-cfgroute-${suffix}`;
// Sequential-hex HMAC fixture for the signed-route test, not a credential;
// allowlisted by path in .gitleaks.toml.
const SECRET = "0123456789abcdef0123456789abcdef";
const DAY_MS = 24 * 60 * 60 * 1000;
/** The key's expiration date as the gateway reads it: unix seconds. */
const EXPIRES_AT = new Date(Date.now() + 7 * DAY_MS);

/** Stored provider keys arrive already decrypted in these fixtures. */
const credentials: GatewayModelProviderCredentialsPort = {
  readCustomKeys: (stored: unknown) => stored as Record<string, unknown>,
};

class SuiteProjectService extends TestProjectService {
  override async tryGetTraceDestination(
    projectId: string,
  ): ReturnType<ProjectService["tryGetTraceDestination"]> {
    return await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true, apiKey: true, archivedAt: true },
    });
  }

  override async listTraceDestinations(
    projectIds: string[],
  ): ReturnType<ProjectService["listTraceDestinations"]> {
    return await prisma.project.findMany({
      where: { id: { in: projectIds } },
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

let virtualKeys: VirtualKeyService;
let app: ReturnType<typeof createGatewayInternalRestApp>;

function buildApp(): void {
  const projects = new SuiteProjectService();
  const gateway = PrismaGatewayAdapter.create({
    database: prisma,
    projects,
    evaluators: {} as never,
    monitors: {} as never,
    changes: {} as never,
    audit: {} as never,
  }).build();
  const materialiser = new GatewayConfigMaterialiser(prisma, projects, null, gateway, credentials);
  const store = PrismaGatewayInternalStoreAdapter.create({ database: prisma });
  virtualKeys = VirtualKeyService.createForTest(prisma, projects);
  const absent = () => {
    throw new Error("this route is not under test here");
  };
  const ports = {
    internalSecret: () => SECRET,
    virtualKeys: () => virtualKeys,
    projects: () => projects,
    jwt: absent,
    store: () => store,
    changes: absent,
    config: () => materialiser,
    budgetSpend: () => undefined,
  } as unknown as GatewayInternalRestPorts;
  app = createGatewayInternalRestApp({ security: testRestSecurity(), ports });
}

function signedRequest(path: string, ifNoneMatch?: string): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeGatewaySignature(
    SECRET,
    buildGatewayCanonicalString({ method: "GET", path, timestamp, body: "" }),
  );
  return new Request(`http://api.test${path}`, {
    method: "GET",
    headers: {
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
      ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
    },
  });
}

describe.skipIf(!databaseUrl)("GET /api/internal/gateway/config/:vk_id", () => {
  beforeAll(async () => {
    buildApp();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Cfg Org ${suffix}`, slug: `cfgroute-${suffix}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, name: "Cfg Route", email: `cfgroute-${suffix}@acme.test` },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_ID,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: { OPENAI_API_KEY: "fake-before-rotation" },
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    await prisma.routingPolicy.create({
      data: {
        id: RP_ID,
        organizationId: ORG_ID,
        name: `Cfg Policy ${suffix}`,
        modelProviderIds: [MP_ID],
        modelAliases: { chat: "openai/gpt-5-mini" },
        policyRules: { models: { deny: ["^internal-.*$"], allow: null } },
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Cfg Team ${suffix}`,
        slug: `cfgroute-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Cfg Project ${suffix}`,
        slug: `cfgroute-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `cfgroute-key-${suffix}`,
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: `Cfg VK ${suffix}`,
        hashedSecret: `hashed-${suffix}`,
        displayPrefix: "vk-lw-cfgro",
        createdById: USER_ID,
        routingPolicyId: RP_ID,
        config: {},
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_EXPIRING_ID,
        organizationId: ORG_ID,
        name: `Cfg Expiring VK ${suffix}`,
        hashedSecret: `hashed-exp-${suffix}`,
        displayPrefix: "vk-lw-cfgexp",
        createdById: USER_ID,
        traceProjectId: PROJECT_ID,
        expiresAt: EXPIRES_AT,
        config: {},
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await prisma.virtualKeyScope.deleteMany({
      where: { virtualKeyId: { in: [VK_ID, VK_EXPIRING_ID] } },
    });
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { id: { in: [VK_ID, VK_EXPIRING_ID] } } });
    await prisma.routingPolicy.deleteMany({ where: { id: RP_ID } });
    await prisma.modelProvider.deleteMany({ where: { id: MP_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  }, 60_000);

  describe("when the VK links a routing policy", () => {
    it("ships the policy's model aliases and model deny rules on the bundle", async () => {
      const path = `/api/internal/gateway/config/${VK_ID}`;
      const res = await app.fetch(signedRequest(path));

      expect(res.status).toBe(200);
      const bundle = (await res.json()) as {
        model_aliases: Record<string, string>;
        policy_rules: { models: { deny: string[]; allow: string[] | null } };
      };
      expect(bundle.model_aliases).toEqual({ chat: "openai/gpt-5-mini" });
      expect(bundle.policy_rules.models.deny).toEqual(["^internal-.*$"]);
    });
  });

  // The gateway revalidates a cached bundle with If-None-Match rather than
  // downloading it again. A rotated credential writes the provider row and
  // nothing else, so a token that only tracks the key's revision answers 304
  // to a bundle carrying the key the operator just replaced.
  describe("when a provider credential is rotated", () => {
    const path = `/api/internal/gateway/config/${VK_ID}`;

    async function apiKeyOnBundle(res: Response) {
      const bundle = (await res.json()) as {
        providers: { id: string; credentials: { api_key?: string } }[];
      };
      return bundle.providers.find((p) => p.id === MP_ID)?.credentials.api_key;
    }

    /** @scenario "a credential written straight to the row still moves the version token" */
    /** @scenario "a key nobody touched keeps its version token" */
    it("answers a fresh bundle instead of confirming the cached one", async () => {
      const cold = await app.fetch(signedRequest(path));
      expect(cold.status).toBe(200);
      const coldETag = cold.headers.get("ETag");
      expect(coldETag).toBeTruthy();
      expect(await apiKeyOnBundle(cold)).toBe("fake-before-rotation");

      // What the gateway does every 60 seconds while nothing changes.
      const revalidated = await app.fetch(signedRequest(path, coldETag ?? ""));
      expect(revalidated.status).toBe(304);

      await prisma.modelProvider.update({
        where: { id: MP_ID },
        data: { customKeys: { OPENAI_API_KEY: "fake-after-rotation" } },
      });

      const afterRotation = await app.fetch(signedRequest(path, coldETag ?? ""));
      expect(afterRotation.status).toBe(200);
      expect(afterRotation.headers.get("ETag")).not.toBe(coldETag);
      expect(await apiKeyOnBundle(afterRotation)).toBe("fake-after-rotation");
    });
  });

  /** Reads the raw JSON, not a parsed object, because the gateway tells an
   *  explicit null apart from a field that is not there at all: the first says
   *  the key never expires, the second says an older control plane answered
   *  nothing and the gateway must keep the date it holds. */
  async function fetchConfig(vkId: string) {
    const res = await app.fetch(signedRequest(`/api/internal/gateway/config/${vkId}`));
    const text = await res.text();
    return {
      status: res.status,
      etag: res.headers.get("ETag"),
      raw: text,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    };
  }

  describe("when the key carries an expiration date", () => {
    /** @scenario "the config endpoint carries the key's expiration date" */
    it("carries the date in unix seconds, and an explicit null for a key that never expires", async () => {
      const expiring = await fetchConfig(VK_EXPIRING_ID);
      expect(expiring.status).toBe(200);
      expect(expiring.body?.expires_at).toBe(Math.floor(EXPIRES_AT.getTime() / 1000));

      const never = await fetchConfig(VK_ID);
      expect(never.status).toBe(200);
      expect(never.body?.expires_at).toBeNull();
      expect(never.raw).toContain('"expires_at":null');
    });

    /** @scenario "changing only the date moves the config version token" */
    it("moves the version token when only the date changes, so the next revalidation brings the new date", async () => {
      const before = await fetchConfig(VK_EXPIRING_ID);
      const shortened = new Date(Date.now() + DAY_MS);

      await virtualKeys.update({
        id: VK_EXPIRING_ID,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        expiresAt: shortened,
      });

      const after = await fetchConfig(VK_EXPIRING_ID);
      expect(after.etag).not.toBe(before.etag);
      expect(after.body?.expires_at).toBe(Math.floor(shortened.getTime() / 1000));

      // The token the gateway held is the one its staleness refresh revalidates
      // with. It has to come back 200 with the new date, not 304, or a shortened
      // date would sit behind the old config until something else evicted the
      // entry.
      const path = `/api/internal/gateway/config/${VK_EXPIRING_ID}`;
      const revalidated = await app.fetch(signedRequest(path, before.etag ?? ""));
      expect(revalidated.status).toBe(200);
      const payload = (await revalidated.json()) as { expires_at: number };
      expect(payload.expires_at).toBe(Math.floor(shortened.getTime() / 1000));

      // And the token it now holds still revalidates to a 304, so an unchanged
      // key stays cheap.
      const unchanged = await app.fetch(signedRequest(path, after.etag ?? ""));
      expect(unchanged.status).toBe(304);
    });
  });
});
