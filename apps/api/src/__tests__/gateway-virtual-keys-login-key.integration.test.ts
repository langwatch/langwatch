/**
 * The virtual key routes, asked with the organization key `langwatch login` mints, through the
 * door auth binds, over a real Postgres, Redis and ClickHouse.
 * @vitest-environment node
 * @see specs/ai-gateway/public-rest-api.feature
 * @see specs/security/api-endpoint-authorization.feature
 */
import { createHash, randomBytes } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
import { openApiDoor, type RestIdentity } from "@langwatch/api/hosting";
import { RestHost, type RestTransportMiddlewareBinding } from "@langwatch/api/rest";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing } from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  bootInstalledProcess,
  composeApiApplication,
  type InstallableServerFeature,
  processConfig,
  storesBackedMembers,
  withMemoryRepositories,
} from "@langwatch/process";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
  type ProcessMembers,
} from "@langwatch/process-stores";
import { RedisConnectionService } from "@langwatch/redis-client";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { processModules } from "../process-modules.generated.ts";
import { routedQueryClient, startMigratedClickHouse } from "./monitor-performance.fixture.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const clickHouseUrl = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
const stores = databaseUrl && redisUrl && clickHouseUrl;

const connection = databaseUrl
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:virtual-keys-login-key"),
      guard: new AllowTestQueries(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();
const BASE_URL = "http://langwatch.test";

/** What a virtual key request reads and writes; every other module runs over memory. */
const LIVE_MODULES: ReadonlySet<string> = new Set([
  "api-key",
  "auth",
  "authz",
  "gateway",
  "organization",
  "project",
]);

function unreachable<Client extends object>(name: string): Client {
  return new Proxy({} as Client, {
    get: (_target, property) => {
      throw new Error(`${name}.${String(property)} is not reachable in this suite`);
    },
  });
}

function tierOf(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  if (LIVE_MODULES.has(module.name) || module.repositoryRegistry === void 0) return module;
  return withMemoryRepositories(module);
}

const wireBody = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  data: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  virtual_key: z.object({ id: z.string() }).optional(),
  virtual_key_id: z.string().optional(),
  spent_usd: z.string().optional(),
  requests: z.number().optional(),
});

/** The api, installed as `main.ts` installs it, serving REST behind the door auth binds. */
async function bootInstallation({ clickHouse }: { clickHouse: ClickHouseClient }) {
  const environment: Record<string, string> = {
    NODE_ENV: "test",
    BASE_HOST: BASE_URL,
    NEXTAUTH_URL: BASE_URL,
    NEXTAUTH_SECRET: "test-secret-test-secret-test-secret",
    API_KEY_PEPPER: "synthetic-api-key-pepper",
    LW_VIRTUAL_KEY_PEPPER: "synthetic-virtual-key-pepper",
  };
  const owners = processConfig(processModules, "api");
  const config = parseProcessConfig({ owners, environment });
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  const redis = new RedisConnectionService().connect({ url: redisUrl });
  if (!redis) throw new Error("the test Redis did not connect");
  const refuse = () => {
    throw new Error("this suite authenticates with an API key only");
  };
  const closed: RestIdentity = {
    authenticate: refuse,
    identify: refuse,
    identifyOptional: refuse,
    authorize: refuse,
  };

  let rest: RestHost | undefined;
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: processModules.map(tierOf),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    surface: (peers) => {
      const door = openApiDoor(peers);
      const bound = new Set(
        peers.facts.flatMap(({ facts }) =>
          facts.flatMap((fact) =>
            "middleware" in fact ? [(fact as RestTransportMiddlewareBinding).middleware.name] : [],
          ),
        ),
      );
      const unbound = new Map<string, { middleware: { name: string }; resolve: () => never }>();
      for (const module of processModules) {
        for (const transport of module.transports ?? []) {
          if (transport.protocol !== "rest") continue;
          const declaration = transport.router() as {
            routes: readonly { middleware?: readonly { name: string }[] }[];
          };
          for (const route of declaration.routes) {
            for (const fact of route.middleware ?? []) {
              if (!bound.has(fact.name)) {
                unbound.set(fact.name, { middleware: fact, resolve: refuse });
              }
            }
          }
        }
      }
      rest = RestHost.create({
        identities: {
          ...door.identities,
          scim_token: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
        idempotency: async ({ handler }) => {
          const response = await handler();
          return { isReplayed: false, status: response.status, response };
        },
        rateLimiter: { check: async () => ({ allowed: true }) },
        facts: [...unbound.values()] as never,
        entitlements: door.entitlements,
      });
      const mountNothing = { mount: () => {} };

      return {
        hosts: { rest, trpc: mountNothing, websocket: mountNothing, rawhttp: mountNothing },
        serve: () => void 0,
      } as never;
    },
    members: {
      ...storesBackedMembers(memoryStores(), {
        logger: createTestLogger().logger,
        clock: systemClock(),
        secrets: resolvedSecrets({}),
        encryption: aesEncryption(new Uint8Array(32)),
        telemetry: unreachable<ProcessMembers["telemetry"]>("telemetry"),
        prisma,
        clickhouse: routedQueryClient(clickHouse),
        objectStorage: unreachable<ProcessMembers["objectStorage"]>("objectStorage"),
        cache: unreachable<ProcessMembers["cache"]>("cache"),
        idempotency: { claim: async () => true },
        rateLimiter: { check: async () => ({ allowed: true }) },
        eventing: new EventSourcing({
          enabled: false,
          participation: "produce",
          processManagerMode: "producer-only",
        }),
        redis,
        publicBaseUrl: config.process.baseHost,
        serviceVersion: "test",
        telemetryExporter: {
          endpoint: void 0,
          withHeaders: <Out>(build: (headers: Readonly<Record<string, string>>) => Out): Out =>
            build({}),
        },
        nodeEnvironment: config.process.nodeEnvironment,
        isSaas: config.process.isSaas ?? false,
        nlpServiceUrl: config.process.nlpServiceUrl,
        nlpCodeBlockTimeoutSeconds: config.process.nlpCodeBlockTimeoutSeconds,
        nlpInternalSecret: void 0,
        outboundProxy: config.process.outboundProxy,
        processName: "langwatch-api",
        storageResolver: void 0,
        storage: void 0,
        queue: void 0,
        content: void 0,
        connectJudge: null,
        rawSocketPort: 0,
        monitor: void 0,
        langwatchQl: {
          admin: { configured: false },
          postgres: { configured: false },
          database: () => prisma,
        },
      }),
      close: async () => void 0,
    },
  });
  if (!rest) throw new Error("the api booted without a REST host");
  const application = composeApiApplication({ rest });

  return {
    runtime,
    stop: async () => {
      await runtime.stop();
      await redis.quit();
    },
    send: async ({
      path,
      token,
      projectId,
      method = "GET",
      body,
    }: {
      path: string;
      token: string;
      projectId?: string;
      method?: string;
      body?: object;
    }) => {
      const response = await application.fetch(
        new Request(`${BASE_URL}/api/gateway/v1${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(projectId ? { "X-Project-Id": projectId } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );

      return { status: response.status, answer: wireBody.parse(await response.json()) };
    },
  };
}

describe.skipIf(!stores)("given the organization key a CLI login holds", () => {
  let installation: Awaited<ReturnType<typeof bootInstallation>>;
  let organizationId: string;
  let userId: string;
  let teamId: string;
  let personalProjectId: string;
  let otherProjectId: string;
  let otherTeamId: string;
  let billingProjectId: string;
  let loginKey: string;
  let teamKey: string;
  let emptyKey: string;
  let virtualKeyId: string;
  let checkoutKeyId: string;
  let billingKeyId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Ada", email: `ada-${ns}@example.com` },
    });
    userId = user.id;
    const organization = await prisma.organization.create({
      data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    await prisma.organizationUser.create({ data: { userId, organizationId, role: "ADMIN" } });
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-admin-${ns}`,
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    const team = await prisma.team.create({
      data: { name: "Platform", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    await prisma.teamUser.create({ data: { userId, teamId, role: "ADMIN" } });
    const otherTeam = await prisma.team.create({
      data: { name: "Payments", slug: `--test-team-payments-${ns}`, organizationId },
    });
    otherTeamId = otherTeam.id;
    const project = async (name: string, inTeamId = teamId) =>
      (
        await prisma.project.create({
          data: {
            name,
            slug: `--test-project-${name}-${ns}`,
            apiKey: `--test-key-${name}-${ns}`,
            teamId: inTeamId,
            language: "python",
            framework: "openai",
          },
        })
      ).id;
    personalProjectId = await project("personal");
    otherProjectId = await project("checkout");
    billingProjectId = await project("billing", otherTeamId);

    installation = await bootInstallation({ clickHouse: await startMigratedClickHouse() });

    // The rows a device login leaves once the worker has folded the key's grant.
    const seedKey = async ({
      name,
      scopeType,
      scopeId,
      roleKey = "admin",
    }: {
      name: string;
      scopeType: "ORGANIZATION" | "TEAM";
      scopeId: string;
      roleKey?: string;
    }) => {
      const lookupId = randomBytes(8).toString("hex");
      const secret = randomBytes(24).toString("hex");
      const apiKey = await prisma.apiKey.create({
        data: {
          name: `${name} ${ns}`,
          lookupId,
          hashedSecret: createHash("sha256").update(secret).digest("hex"),
          permissionMode: "all",
          userId,
          createdByUserId: userId,
          organizationId,
        },
      });
      await prisma.grant.create({
        data: {
          id: `grant-key-${name}-${ns}`,
          organizationId,
          principalType: "API_KEY",
          principalId: apiKey.id,
          roleKey,
          source: "grants-service",
          scopeType,
          scopeId,
          occurredAt: new Date(),
        },
      });

      return `${API_KEY_PREFIX}${lookupId}_${secret}`;
    };
    loginKey = await seedKey({ name: "login", scopeType: "ORGANIZATION", scopeId: organizationId });
    teamKey = await seedKey({ name: "team", scopeType: "TEAM", scopeId: teamId });
    // A role no catalogue names gives its key no permission at all.
    emptyKey = await seedKey({
      name: "empty",
      scopeType: "TEAM",
      scopeId: teamId,
      roleKey: `--test-role-without-permissions-${ns}`,
    });

    const createIn = async (projectId: string) => {
      const created = await installation.send({
        path: "/virtual-keys",
        method: "POST",
        token: loginKey,
        projectId,
        body: { name: `login-key-${projectId}` },
      });
      if (!created.answer.virtual_key) {
        throw new Error(`the virtual key was not created: ${JSON.stringify(created)}`);
      }

      return created.answer.virtual_key.id;
    };
    virtualKeyId = await createIn(personalProjectId);
    checkoutKeyId = await createIn(otherProjectId);
    billingKeyId = await createIn(billingProjectId);
  }, 240_000);

  afterAll(async () => {
    await installation?.stop();
    if (organizationId) {
      await prisma.virtualKeyScope.deleteMany({ where: { virtualKey: { organizationId } } });
      await prisma.virtualKey.deleteMany({ where: { organizationId } });
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({ where: { teamId: { in: [teamId, otherTeamId] } } });
      await prisma.teamUser.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: { in: [teamId, otherTeamId] } } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await connection?.closeOnce();
  });

  describe("when it names no project", () => {
    /** @scenario "A login key that names no project lists every virtual key it can see" */
    it("lists the keys of every project and reads one key and its spend", async () => {
      const listed = await installation.send({ path: "/virtual-keys", token: loginKey });
      const read = await installation.send({
        path: `/virtual-keys/${billingKeyId}`,
        token: loginKey,
      });
      const spend = await installation.send({
        path: `/virtual-keys/${billingKeyId}/spend`,
        token: loginKey,
      });

      expect(listed.status).toBe(200);
      expect(listed.answer.data?.map((key) => key.id).toSorted()).toEqual(
        [virtualKeyId, checkoutKeyId, billingKeyId].toSorted(),
      );
      expect(read).toMatchObject({ status: 200, answer: { virtual_key: { id: billingKeyId } } });
      expect(spend).toMatchObject({
        status: 200,
        answer: { virtual_key_id: billingKeyId, requests: 0 },
      });
    });

    /** @scenario "A key that names no project manages a virtual key by its scopes" */
    it("creates, disables, enables and revokes a key by the scopes it names", async () => {
      const created = await installation.send({
        path: "/virtual-keys",
        method: "POST",
        token: loginKey,
        body: {
          name: `scoped-${ns}`,
          scopes: [{ scope_type: "project", scope_id: otherProjectId }],
        },
      });
      const id = created.answer.virtual_key?.id;
      const statuses: number[] = [];
      for (const step of ["disable", "enable", "revoke"]) {
        const answered = await installation.send({
          path: `/virtual-keys/${id}/${step}`,
          method: "POST",
          token: loginKey,
          body: {},
        });
        statuses.push(answered.status);
      }
      const unscoped = await installation.send({
        path: "/virtual-keys",
        method: "POST",
        token: loginKey,
        body: { name: `unscoped-${ns}` },
      });

      expect(created.status).toBe(201);
      expect(statuses).toEqual([200, 200, 200]);
      expect(unscoped).toMatchObject({ status: 422, answer: { code: "validation_error" } });
    });

    it("still tells a project route to name its project", async () => {
      const refused = await installation.send({ path: "/cache-rules", token: loginKey });

      expect(refused).toMatchObject({ status: 400, answer: { code: "project_required" } });
    });
  });

  describe("when it names the project it acts on", () => {
    /** @scenario "A login key narrows the listing to the project it names" */
    it("lists that project's virtual keys only and reads one key's spend", async () => {
      const listed = await installation.send({
        path: "/virtual-keys",
        token: loginKey,
        projectId: personalProjectId,
      });
      const spend = await installation.send({
        path: `/virtual-keys/${virtualKeyId}/spend`,
        token: loginKey,
        projectId: personalProjectId,
      });

      expect(listed.status).toBe(200);
      expect(listed.answer.data?.map((key) => key.id)).toEqual([virtualKeyId]);
      expect(spend).toMatchObject({
        status: 200,
        answer: { virtual_key_id: virtualKeyId, requests: 0 },
      });
    });

    it("does not read a sibling project's key by id", async () => {
      const read = await installation.send({
        path: `/virtual-keys/${checkoutKeyId}`,
        token: loginKey,
        projectId: personalProjectId,
      });

      expect(read).toMatchObject({ status: 404, answer: { code: "virtual_key_not_found" } });
    });
  });

  describe("given a key granted on one team only, naming no project", () => {
    /** @scenario "A key that names no project sees only the virtual keys its grants reach" */
    it("lists its team's keys and answers another team's key as not found", async () => {
      const listed = await installation.send({ path: "/virtual-keys", token: teamKey });
      const read = await installation.send({
        path: `/virtual-keys/${billingKeyId}`,
        token: teamKey,
      });

      expect(listed.status).toBe(200);
      expect(listed.answer.data?.map((key) => key.id)).not.toContain(billingKeyId);
      expect(listed.answer.data?.map((key) => key.id)).toEqual(
        expect.arrayContaining([virtualKeyId, checkoutKeyId]),
      );
      expect(read).toMatchObject({ status: 404, answer: { code: "virtual_key_not_found" } });
    });
  });

  describe("given a key whose grants hold no virtual key permission, naming no project", () => {
    /** @scenario "A key that holds a virtual key permission on none of its grants is refused" */
    it("is refused before any virtual key is read", async () => {
      const listed = await installation.send({ path: "/virtual-keys", token: emptyKey });
      const read = await installation.send({
        path: `/virtual-keys/${virtualKeyId}`,
        token: emptyKey,
      });

      expect(listed).toMatchObject({ status: 403, answer: { code: "permission_denied" } });
      expect(read).toMatchObject({ status: 403, answer: { code: "permission_denied" } });
    });
  });

  describe("when the token stands for no key at all", () => {
    it("is still refused as an invalid credential", async () => {
      const refused = await installation.send({
        path: "/virtual-keys",
        token: `${loginKey.slice(0, -4)}0000`,
      });

      expect(refused).toMatchObject({ status: 401, answer: { code: "invalid_credentials" } });
    });
  });
});
