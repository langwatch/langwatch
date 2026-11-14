/**
 * The credential census on the api booted wholly live over Postgres, Redis and ClickHouse: a
 * legacy project key from the Python SDK and a scoped key from the CLI, through the door auth
 * binds, counted by credential, project, route template and client; answers unchanged.
 * @vitest-environment node
 * @see modules/auth/specs/request-credential-census.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import type * as Census from "@langwatch/observability/credential-census";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { bootLiveApi, liveStoresConfigured, openLivePrisma } from "./api-live.fixture.ts";

const counted = vi.hoisted(() => [] as Census.CensusRequest[]);

vi.mock("@langwatch/observability/credential-census", async (importOriginal) => {
  const actual = await importOriginal<typeof Census>();
  return {
    ...actual,
    recordCredentialCensus: (request: Census.CensusRequest) => counted.push(request),
  };
});

const PYTHON_SDK = {
  "User-Agent": "langwatch-sdk-python/0.9.0",
  "X-LangWatch-SDK-Name": "langwatch-observability-sdk",
  "X-LangWatch-SDK-Language": "python",
  "X-LangWatch-SDK-Version": "0.9.0",
};

const CLI = {
  "User-Agent": "langwatch-sdk-node/3.1.0",
  "X-LangWatch-SDK-Name": "langwatch-observability-sdk",
  "X-LangWatch-SDK-Language": "typescript",
  "X-LangWatch-SDK-Version": "3.1.0",
  "X-LangWatch-Surface": "cli",
};

const ns = generate("test").toString().toLowerCase();

describe.skipIf(!liveStoresConfigured)("given the credential census on the live api", () => {
  const live = liveStoresConfigured ? openLivePrisma({ label: "credential-census" }) : null;
  const prisma = live?.prisma as PrismaClient;
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let legacyKey: string;
  const keys: Record<"viewer" | "stranger", { id: string; token: string }> = {
    viewer: { id: "", token: "" },
    stranger: { id: "", token: "" },
  };

  /** A key row with a role holding `permissions` on the project, as the worker's fold leaves it. */
  async function seedKey({ name, permissions }: { name: string; permissions: string[] }) {
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name: `${name} ${ns}`,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "restricted",
        userId: null,
        organizationId,
      },
    });
    const roleId = `apikey:${apiKey.id}`;
    await prisma.role.create({
      data: {
        id: roleId,
        organizationId,
        name: roleId,
        permissions,
        kind: "system_api_key",
        occurredAt: new Date(),
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-${name}-${ns}`,
        organizationId,
        principalType: "API_KEY",
        principalId: apiKey.id,
        roleKey: `custom:${roleId}`,
        source: "grants-service",
        scopeType: "PROJECT",
        scopeId: projectId,
        occurredAt: new Date(),
      },
    });

    return { id: apiKey.id, token: `${API_KEY_PREFIX}${lookupId}_${secret}` };
  }

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    const team = await prisma.team.create({
      data: { name: "Platform", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    legacyKey = `sk-lw-${randomBytes(16).toString("hex")}`;
    const project = await prisma.project.create({
      data: {
        name: "census",
        slug: `--test-project-${ns}`,
        apiKey: legacyKey,
        teamId,
        language: "python",
        framework: "openai",
      },
    });
    projectId = project.id;
    keys.viewer = await seedKey({ name: "viewer", permissions: ["prompts:view"] });
    keys.stranger = await seedKey({ name: "stranger", permissions: ["datasets:view"] });
    api = await bootLiveApi();
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationId) {
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.role.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await live?.close();
  });

  beforeEach(() => {
    counted.length = 0;
  });

  const listPrompts = ({ token, headers }: { token: string; headers: Record<string, string> }) =>
    api.fetch(`/api/prompts?projectId=${projectId}&secret=query-value`, {
      headers: { ...headers, Authorization: `Bearer ${token}`, "X-Project-Id": projectId },
    });

  describe("when the Python SDK lists prompts with the project's legacy key", () => {
    /** @scenario "A legacy project key sent by the Python SDK is counted as a legacy key from sdk-python" */
    /** @scenario "The census line never carries the token or the query string" */
    it("counts a legacy project key for the project from sdk-python, without token or query", async () => {
      const response = await listPrompts({ token: legacyKey, headers: PYTHON_SDK });

      expect(response.status).toBe(200);
      expect(counted).toEqual([
        expect.objectContaining({
          credentialType: "legacy_project_key",
          projectId,
          method: "GET",
          route: "/api/prompts",
          client: "sdk-python",
          sdkVersion: "0.9.0",
          status: 200,
        }),
      ]);
      const written = JSON.stringify(counted);
      expect(written).not.toContain(legacyKey);
      expect(written).not.toContain("query-value");
    });
  });

  describe("when the CLI lists prompts with a scoped key", () => {
    /** @scenario "A new API key sent by the CLI is counted with its key id and client cli" */
    it("counts an API key with its row id from the CLI", async () => {
      const response = await listPrompts({ token: keys.viewer.token, headers: CLI });

      expect(response.status).toBe(200);
      expect(counted).toEqual([
        expect.objectContaining({
          credentialType: "api_key",
          apiKeyId: keys.viewer.id,
          projectId,
          client: "cli",
          status: 200,
        }),
      ]);
    });
  });

  describe("when a key without the permission and one with it call the same route", () => {
    /** @scenario "Counting a request does not change its authorization answer" */
    it("refuses the one and answers the other, each counted with its own status", async () => {
      const refused = await listPrompts({ token: keys.stranger.token, headers: CLI });
      const answered = await listPrompts({ token: keys.viewer.token, headers: CLI });
      const unknown = await listPrompts({ token: `${legacyKey}-not-ours`, headers: CLI });

      expect(refused.status).toBe(403);
      expect(answered.status).toBe(200);
      expect(unknown.status).toBe(401);
      expect(counted.map(({ apiKeyId, status }) => ({ apiKeyId, status }))).toEqual([
        { apiKeyId: keys.stranger.id, status: 403 },
        { apiKeyId: keys.viewer.id, status: 200 },
      ]);
    });
  });

  describe("when an SDK posts a trace to the collector with the legacy key", () => {
    /** @scenario "Trace ingest through the collector is counted per project" */
    it("counts it for the collector route and the project", async () => {
      await api.fetch("/api/collector", {
        method: "POST",
        headers: { ...PYTHON_SDK, "X-Auth-Token": legacyKey, "Content-Type": "application/json" },
        body: JSON.stringify({ trace_id: `trace-${ns}`, spans: [] }),
      });

      expect(counted).toEqual([
        expect.objectContaining({
          credentialType: "legacy_project_key",
          projectId,
          method: "POST",
          route: "/api/collector",
          client: "sdk-python",
        }),
      ]);
    });
  });

  describe("when an OpenTelemetry exporter posts spans to the OTLP receiver with the legacy key", () => {
    /** @scenario "Trace ingest through the collector is counted per project" */
    it("counts it for the OTLP route and the project, from the exporter", async () => {
      await api.fetch("/api/otel/v1/traces", {
        method: "POST",
        headers: {
          "User-Agent": "OTel-OTLP-Exporter-Python/1.30.0",
          Authorization: `Bearer ${legacyKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ resourceSpans: [] }),
      });

      expect(counted).toEqual([
        expect.objectContaining({
          credentialType: "legacy_project_key",
          projectId,
          method: "POST",
          client: "otel-exporter",
        }),
      ]);
      expect(counted[0]?.route).toMatch(/^\/api\/otel\/v1\/traces/);
    });
  });
});
