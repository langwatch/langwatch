/**
 * Staff access keys through the installed REST door (ADR-202): the api and worker booted wholly
 * live, a requester key asking over the wire, and the redeemed key minted by the real api-key
 * module. Only the passkey ceremony is skipped: the approval columns are written directly.
 * @vitest-environment node
 * @see modules/staff-access/specs/staff-access-use.feature
 * @see modules/staff-access/specs/staff-access-approval.feature
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import {
  AUTHZ_ENGINE_MIGRATION_NAME,
  PLATFORM_OPERATOR_ROLE_ID,
  PLATFORM_TENANT_ID,
} from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { TASKS_APP_DIRECTORY } from "@langwatch/upgrade/gate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  bootLiveApi,
  liveDatabaseUrl,
  liveStoresConfigured,
  openLivePrisma,
  removeSeededTraces,
  seedProject,
  seedTraceSummary,
  type LiveApi,
  SYNTHETIC_ENVIRONMENT,
} from "./api-live.fixture.ts";
import { startMigratedClickHouseEndpoint } from "./monitor-performance.fixture.ts";

const stores = liveStoresConfigured;

const FLAG = "ops_agent_access_enabled";
const REQUESTER_PREFIX = "lwsr_";
const PRINCIPAL = "LangWatch Support";
const AGENT_IP = "203.0.113.7";
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REASON = "fix ACME's broken evaluator";

type Scope = "org:metadata" | "org:content" | "org:support";

/** LangWatchQL's restricted identity for this suite: its own user, never a dev stack's. */
const LWQL_ENVIRONMENT: Readonly<Record<string, string>> = {
  LWQL_CLICKHOUSE_USER: "langwatch_test_staff_access_lwql",
  LWQL_CLICKHOUSE_PASSWORD: "synthetic-lwql-password",
  LWQL_POSTGRES_READER_ROLE: "langwatch_test_staff_access_lwql_reader",
  LWQL_POSTGRES_READER_PASSWORD: "synthetic-lwql-reader-password",
  LWQL_ACCESS_MODEL_MODE: "sql",
};

/** Provisions LangWatchQL over the live test stores, as the upgrade's reconciler does. */
async function provisionLangWatchQL({ clickHouseUrl }: { clickHouseUrl: string }) {
  const outcome = await new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-transform-types", "src/main.ts", "lwql-provision"],
      {
        cwd: TASKS_APP_DIRECTORY,
        stdio: "pipe",
        env: {
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          ...SYNTHETIC_ENVIRONMENT,
          ...LWQL_ENVIRONMENT,
          BASE_HOST: "http://langwatch.test",
          NEXTAUTH_URL: "http://langwatch.test",
          DATABASE_URL: liveDatabaseUrl(),
          REDIS_URL: process.env.LANGWATCH_TEST_REDIS_URL ?? "",
          CLICKHOUSE_URL: clickHouseUrl,
        },
      },
    );
    const chunks: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    child.once("close", (code) => resolve({ code: code ?? 1, output: chunks.join("") }));
  });
  if (outcome.code !== 0) {
    throw new Error(`lwql-provision exited ${outcome.code}: ${outcome.output.slice(-4000)}`);
  }
}

const answerSchema = z.looseObject({ code: z.string().optional() });
const createdSchema = z.object({ requestId: z.string() });
const redeemedSchema = z.object({ apiKey: z.string(), organizationId: z.string() });

describe.skipIf(!stores)("given staff access keys on the live api", () => {
  let api: LiveApi;
  let prisma: PrismaClient;
  let closePrisma: () => Promise<void>;
  let oliviaId: string;
  let flagBefore: { enabled: boolean } | null;
  const ns = generate("test").toString().toLowerCase();
  const acme = { id: "", slug: `--test-org-acme-${ns}`, projectId: "" };
  const globex = { id: "", slug: `--test-org-globex-${ns}`, projectId: "" };
  const acmeTrace = `trace-acme-${ns}`;
  const globexTrace = `trace-globex-${ns}`;
  const requestIds: string[] = [];

  async function seedOrganization({ name, slug }: { name: string; slug: string }) {
    const organization = await prisma.organization.create({ data: { name, slug } });
    const team = await prisma.team.create({
      data: { name: `${name} team`, slug: `${slug}-team`, organizationId: organization.id },
    });
    const project = await seedProject({ prisma, teamId: team.id, label: name.toLowerCase() });
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organization.id,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    await prisma.modelDefaultConfig.create({
      data: {
        organizationId: organization.id,
        config: { DEFAULT: "openai/gpt-5.4-mini" },
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: organization.id }] },
      },
    });
    return { organizationId: organization.id, projectId: project.id };
  }

  /** An enrolled requester of Olivia's, as the enrol ceremony stores one; answers its key. */
  async function enrolledRequester(): Promise<string> {
    const lookupId = randomBytes(12).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    await prisma.staffAccessRequester.create({
      data: {
        id: `staffrequester_${generate("test").toString()}`,
        ownerUserId: oliviaId,
        name: "laptop agent",
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    return `${REQUESTER_PREFIX}${lookupId}_${secret}`;
  }

  async function call({
    path,
    method = "GET",
    bearer,
    projectId,
    body,
  }: {
    path: string;
    method?: string;
    bearer: string;
    projectId?: string;
    body?: unknown;
  }) {
    const response = await api.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        "x-forwarded-for": AGENT_IP,
        "user-agent": "langwatch-cli",
        ...(projectId ? { "x-project-id": projectId } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const json: unknown = (() => {
      try {
        return text ? JSON.parse(text) : undefined;
      } catch {
        return undefined;
      }
    })();
    const parsed = answerSchema.safeParse(json);
    return {
      status: response.status,
      code: parsed.success ? parsed.data.code : undefined,
      json,
      text,
    };
  }

  /** The agent asks over the wire, Olivia's approval lands, and the agent redeems a real key. */
  async function redeemedKey({ scopes }: { scopes: Scope[] }) {
    const requesterKey = await enrolledRequester();
    const asked = await call({
      path: "/api/staff-access/requests",
      method: "POST",
      bearer: requesterKey,
      body: {
        scopes,
        organization: acme.slug,
        reason: REASON,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: "S256",
        machine: "olivia-macbook",
      },
    });
    expect(asked.status, asked.text).toBe(200);
    const { requestId } = createdSchema.parse(asked.json);
    requestIds.push(requestId);
    await prisma.staffAccessRequest.update({
      where: { id: requestId },
      data: {
        status: "approved",
        approvedAt: new Date(),
        approvalCredentialId: "credential1",
        approvalSignature: "c2lnbmVk",
        signedHash: "approved-in-test",
      },
    });
    const redeemed = await call({
      path: `/api/staff-access/requests/${requestId}/redeem`,
      method: "POST",
      bearer: requesterKey,
      body: { codeVerifier: VERIFIER },
    });
    expect(redeemed.status, redeemed.text).toBe(200);
    const { apiKey, organizationId } = redeemedSchema.parse(redeemed.json);
    expect(organizationId).toBe(acme.id);
    return { apiKey, requestId, requesterKey };
  }

  const traceSearch = ({ bearer, projectId }: { bearer: string; projectId: string }) =>
    call({
      path: "/api/traces/search",
      method: "POST",
      bearer,
      projectId,
      body: {
        startDate: Date.now() - 24 * 60 * 60 * 1000,
        endDate: Date.now() + 60 * 60 * 1000,
      },
    });

  beforeAll(async () => {
    ({ prisma, close: closePrisma } = openLivePrisma({ label: "staff-access-rest-door" }));
    const olivia = await prisma.user.create({
      data: { name: "Olivia", email: `olivia-staff-access-${ns}@example.com` },
    });
    oliviaId = olivia.id;
    await prisma.grant.create({
      data: {
        id: `grant-platform-staff-access-${ns}`,
        organizationId: PLATFORM_TENANT_ID,
        principalType: "USER",
        principalId: oliviaId,
        roleKey: PLATFORM_OPERATOR_ROLE_ID,
        source: "grants-service",
        scopeType: "PLATFORM",
        scopeId: PLATFORM_TENANT_ID,
        occurredAt: new Date(),
      },
    });
    flagBefore = await prisma.featureFlag.findUnique({ where: { key: FLAG } });
    await prisma.featureFlag.upsert({
      where: { key: FLAG },
      create: { key: FLAG, enabled: true },
      update: { enabled: true },
    });

    const seededAcme = await seedOrganization({ name: "ACME", slug: acme.slug });
    acme.id = seededAcme.organizationId;
    acme.projectId = seededAcme.projectId;
    const seededGlobex = await seedOrganization({ name: "Globex", slug: globex.slug });
    globex.id = seededGlobex.organizationId;
    globex.projectId = seededGlobex.projectId;
    await seedTraceSummary({ tenantId: acme.projectId, traceId: acmeTrace });
    await seedTraceSummary({ tenantId: globex.projectId, traceId: globexTrace });

    await provisionLangWatchQL({ clickHouseUrl: (await startMigratedClickHouseEndpoint()).url });
    // Cloud ops is on only where the licence key matches, or on a developer's own stack.
    api = await bootLiveApi({
      environment: { NODE_ENV: "development", ...LWQL_ENVIRONMENT },
      withWorker: true,
    });
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (!prisma) return;
    await removeSeededTraces({ tenantIds: [acme.projectId, globex.projectId].filter(Boolean) });
    if (requestIds.length > 0) {
      await prisma.staffAccessEvent.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.staffAccessRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    if (oliviaId) {
      await prisma.staffAccessRequester.deleteMany({ where: { ownerUserId: oliviaId } });
      await prisma.grant.deleteMany({
        where: { organizationId: PLATFORM_TENANT_ID, principalId: oliviaId },
      });
    }
    if (flagBefore) {
      await prisma.featureFlag.update({ where: { key: FLAG }, data: flagBefore });
    } else {
      await prisma.featureFlag.deleteMany({ where: { key: FLAG } });
    }
    for (const organization of [acme, globex].filter(({ id }) => id)) {
      const where = { organizationId: organization.id };
      await prisma.auditLog.deleteMany({ where });
      await prisma.grant.deleteMany({ where });
      await prisma.roleBinding.deleteMany({ where });
      await prisma.customRole.deleteMany({ where });
      await prisma.modelDefaultConfig.deleteMany({ where });
      await prisma.apiKey.deleteMany({ where });
      await prisma.systemMigrationTenantState.deleteMany({
        where: { tenantId: organization.id },
      });
      await prisma.evaluator.deleteMany({ where: { projectId: organization.projectId } });
      await prisma.llmPromptConfigVersion.deleteMany({
        where: { projectId: organization.projectId },
      });
      await prisma.llmPromptConfig.deleteMany({ where: { projectId: organization.projectId } });
      await prisma.project.deleteMany({ where: { id: organization.projectId } });
      await prisma.team.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: organization.id } });
    }
    if (oliviaId) await prisma.user.deleteMany({ where: { id: oliviaId } });
    await closePrisma();
  }, 120_000);

  describe("when an enrolled requester key is presented to a trace read", () => {
    /** @scenario "A requester key can only create requests" */
    it("is refused as no credential and the trace is never read", async () => {
      const requesterKey = await enrolledRequester();

      const answered = await traceSearch({ bearer: requesterKey, projectId: acme.projectId });

      expect({ status: answered.status, code: answered.code }).toEqual({
        status: 401,
        code: "invalid_credentials",
      });
      expect(answered.text).not.toContain(acmeTrace);
    });
  });

  describe("when a content key on ACME reads traces, analytics and LangWatchQL", () => {
    /** @scenario "A read key reads traces, analytics and LWQL in its organization" */
    it("answers 200 on each and writes a trail row per call with the route, status and IP", async () => {
      const { apiKey, requestId } = await redeemedKey({ scopes: ["org:content"] });

      const traces = await traceSearch({ bearer: apiKey, projectId: acme.projectId });
      const analytics = await call({
        path: "/api/analytics/timeseries",
        method: "POST",
        bearer: apiKey,
        projectId: acme.projectId,
        body: {
          series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
          startDate: Date.now() - 24 * 60 * 60 * 1000,
          endDate: Date.now() + 60 * 60 * 1000,
          timeZone: "UTC",
        },
      });
      const lwql = await call({
        path: "/api/v1/query",
        method: "POST",
        bearer: apiKey,
        projectId: acme.projectId,
        body: { sql: "SELECT count() AS traces FROM traces", projectId: acme.projectId },
      });

      expect(traces.status, traces.text).toBe(200);
      expect(traces.text).toContain(acmeTrace);
      expect(analytics.status, analytics.text).toBe(200);
      expect(lwql.status, lwql.text).toBe(200);

      const trail = await prisma.staffAccessEvent.findMany({
        where: { requestId },
        orderBy: { at: "asc" },
      });
      expect(
        trail.map(({ method, path, status, ipAddress, organizationId }) => ({
          method,
          path,
          status,
          ipAddress,
          organizationId,
        })),
      ).toEqual([
        {
          method: "POST",
          path: "/api/traces/search",
          status: 200,
          ipAddress: AGENT_IP,
          organizationId: acme.id,
        },
        {
          method: "POST",
          path: "/api/analytics/timeseries",
          status: 200,
          ipAddress: AGENT_IP,
          organizationId: acme.id,
        },
        {
          method: "POST",
          path: "/api/v1/query",
          status: 200,
          ipAddress: AGENT_IP,
          organizationId: acme.id,
        },
      ]);
      const writeRows = await prisma.auditLog.findMany({
        where: { organizationId: acme.id, action: "staffAccess.write", targetId: requestId },
      });
      const writtenPaths = writeRows.map(
        ({ metadata }) => z.looseObject({ path: z.string() }).parse(metadata).path,
      );
      expect(writtenPaths).not.toContain("/api/traces/search");
      expect(writtenPaths).not.toContain("/api/analytics/timeseries");
    });
  });

  describe("when a content key on ACME reads Globex's traces", () => {
    /** @scenario "A key never reaches a second organization" */
    it("is refused and Globex's trace never leaves", async () => {
      const { apiKey, requestId } = await redeemedKey({ scopes: ["org:content"] });

      const answered = await traceSearch({ bearer: apiKey, projectId: globex.projectId });

      // The door answers a project the key cannot reach as it answers an unknown key.
      expect({ status: answered.status, code: answered.code }).toEqual({
        status: 401,
        code: "invalid_credentials",
      });
      expect(answered.text).not.toContain(globexTrace);
      expect(await prisma.staffAccessEvent.count({ where: { requestId } })).toBe(0);
    });
  });

  describe("when a metadata key on ACME searches traces", () => {
    /** @scenario "A metadata key cannot read trace content" */
    it("is refused 403 and the trace never leaves", async () => {
      const { apiKey } = await redeemedKey({ scopes: ["org:metadata"] });

      const answered = await traceSearch({ bearer: apiKey, projectId: acme.projectId });

      expect({ status: answered.status, code: answered.code }).toEqual({
        status: 403,
        code: "api_key_permission_denied",
      });
      expect(answered.text).not.toContain(acmeTrace);
    });
  });

  describe("when a support key on ACME creates an evaluator and a prompt", () => {
    /** @scenario "A support key creates an evaluator and a prompt as LangWatch Support" */
    it("creates both and ACME's audit log names LangWatch Support, Olivia and the reason for each", async () => {
      const { apiKey, requestId } = await redeemedKey({ scopes: ["org:support"] });

      const evaluator = await call({
        path: "/api/evaluators",
        method: "POST",
        bearer: apiKey,
        projectId: acme.projectId,
        body: {
          name: `Staff exact match ${ns}`,
          config: { evaluatorType: "langevals/exact_match" },
        },
      });
      const prompt = await call({
        path: "/api/prompts",
        method: "POST",
        bearer: apiKey,
        projectId: acme.projectId,
        body: { handle: `staff-support-${ns}`, prompt: "Answer in one short paragraph." },
      });

      expect(evaluator.status, evaluator.text).toBe(200);
      expect(prompt.status, prompt.text).toBe(200);
      expect(
        await prisma.evaluator.count({
          where: { projectId: acme.projectId, name: `Staff exact match ${ns}` },
        }),
      ).toBe(1);
      const promptId = z.object({ id: z.string() }).parse(prompt.json).id;
      expect(
        await prisma.llmPromptConfig.count({ where: { projectId: acme.projectId, id: promptId } }),
      ).toBe(1);

      const rows = await prisma.auditLog.findMany({
        where: { organizationId: acme.id, action: "staffAccess.write", targetId: requestId },
        orderBy: { createdAt: "asc" },
      });
      expect(
        rows.map(({ actorUserId, ipAddress, metadata }) => ({
          actorUserId,
          ipAddress,
          metadata: z
            .looseObject({
              principal: z.string(),
              reason: z.string(),
              path: z.string(),
              approvedBy: z.object({ id: z.string() }),
            })
            .parse(metadata),
        })),
      ).toEqual([
        {
          actorUserId: oliviaId,
          ipAddress: AGENT_IP,
          metadata: expect.objectContaining({
            principal: PRINCIPAL,
            reason: REASON,
            approvedBy: { id: oliviaId },
            path: "/api/evaluators",
          }),
        },
        {
          actorUserId: oliviaId,
          ipAddress: AGENT_IP,
          metadata: expect.objectContaining({
            principal: PRINCIPAL,
            reason: REASON,
            approvedBy: { id: oliviaId },
            path: "/api/prompts",
          }),
        },
      ]);
      expect(await prisma.staffAccessEvent.count({ where: { requestId } })).toBe(2);
    });
  });

  describe("when a support key on ACME reaches for members, API keys or secrets", () => {
    /** @scenario "A support key cannot touch members, API keys or secrets" */
    it("is refused on each and nothing changes", async () => {
      const { apiKey } = await redeemedKey({ scopes: ["org:support"] });
      const keysBefore = await prisma.apiKey.count({ where: { organizationId: acme.id } });

      const answered = {
        listMembers: await call({ path: "/api/organization/members", bearer: apiKey }),
        changeMember: await call({
          path: `/api/organization/members/${oliviaId}`,
          method: "PATCH",
          bearer: apiKey,
          body: { role: "ADMIN" },
        }),
        createKey: await call({
          path: "/api/api-keys",
          method: "POST",
          bearer: apiKey,
          body: { name: `escalation ${ns}`, permissionMode: "all" },
        }),
        readSecrets: await call({
          path: "/api/secrets",
          bearer: apiKey,
          projectId: acme.projectId,
        }),
      };

      expect(
        Object.fromEntries(
          Object.entries(answered).map(([name, { status, code }]) => [name, { status, code }]),
        ),
      ).toEqual({
        listMembers: { status: 403, code: "insufficient_permissions" },
        changeMember: { status: 403, code: "insufficient_permissions" },
        createKey: { status: 403, code: "insufficient_permissions" },
        readSecrets: { status: 403, code: "api_key_permission_denied" },
      });
      expect(await prisma.apiKey.count({ where: { organizationId: acme.id } })).toBe(keysBefore);
    });
  });
});
