import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { holdClickHouseSchemaLockForFile } from "~/server/clickhouse/__tests__/holdSchemaLock";
import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { nanoUsdToDecimalString } from "@langwatch/gateway-contract";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createMeRestApp } from "@langwatch/platform-api";
import { appRestSecurity } from "~/server/api/security";

const { hono: app } = createMeRestApp({
  security: appRestSecurity,
  personalUsage: () => getApp().governanceApp,
  organizations: () => getApp().organizationService,
  projects: () => getApp().projects.projectService,
});

/** Minimal trace_summaries seed — mirrors the PersonalUsageService test helper. */
async function insertTrace({
  ch,
  tenantId,
  traceId,
  occurredAt,
  totalCost,
  models,
}: {
  ch: ClickHouseClient;
  tenantId: string;
  traceId: string;
  occurredAt: Date;
  totalCost: number;
  models: string[];
}): Promise<void> {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        Attributes: {},
        OccurredAt: occurredAt,
        CreatedAt: occurredAt,
        UpdatedAt: occurredAt,
        ComputedIOSchemaVersion: "",
        ComputedInput: null,
        ComputedOutput: null,
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 100,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: models,
        TotalCost: totalCost,
        NonBilledCost: 0,
        TokensEstimated: false,
        TotalPromptTokenCount: 10,
        TotalCompletionTokenCount: 5,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * Minimal gateway_budget_ledger_events seed — mirrors the columns
 * insertDebit writes (budget.clickhouse.repository.ts). PRINCIPAL-scope
 * rows are how ingestion sources (Claude Code OTLP) land per-user spend,
 * written under the org's hidden Governance Project tenant.
 *
 * Money is seeded as the integer nano-USD the writer carries, and `AmountUSD`
 * is derived from it exactly as the writer derives it: the decimal column is
 * a six-place rendering of one debit, never the figure a read sums.
 */
async function insertLedgerRow({
  ch,
  tenantId,
  scopeId,
  amountNanoUsd,
  model,
  occurredAt,
  status = "success",
  gatewayRequestId = `req-${nanoid(8)}`,
}: {
  ch: ClickHouseClient;
  tenantId: string;
  scopeId: string;
  amountNanoUsd: number;
  model: string;
  occurredAt: Date;
  /** `provider_error` and `blocked_by_guardrail` are debits nobody spent. */
  status?: "success" | "provider_error" | "blocked_by_guardrail";
  /**
   * Defaults to a fresh request. Pass the same id twice to seed the two
   * rows one request writes when two budgets apply to it.
   */
  gatewayRequestId?: string;
}): Promise<void> {
  await ch.insert({
    table: "gateway_budget_ledger_events",
    values: [
      {
        TenantId: tenantId,
        BudgetId: `budget-${nanoid(6)}`,
        Scope: "principal",
        ScopeId: scopeId,
        Window: "MONTH",
        VirtualKeyId: "",
        ProviderCredentialId: "",
        GatewayRequestId: gatewayRequestId,
        AmountNanoUSD: amountNanoUsd,
        AmountUSD: nanoUsdToDecimalString(BigInt(amountNanoUsd)),
        TokensInput: 10,
        TokensOutput: 5,
        TokensCacheRead: 0,
        TokensCacheWrite: 0,
        Model: model,
        ProviderSlot: "",
        DurationMS: 0,
        Status: status,
        OccurredAt: occurredAt.getTime(),
        EventTimestamp: occurredAt.getTime(),
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

// Held for the whole file. The rollup this suite writes to and reads back is
// database-wide, so a neighbouring suite rebuilding it drops the materialised
// view out from under these fixtures.
holdClickHouseSchemaLockForFile();

describe("Feature: Personal usage REST API", () => {
  const ns = `me-usage-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let userId: string;
  let ch: ClickHouseClient | null = null;

  // A personal project with seeded usage, a personal project with none, and a
  // shared (non-personal) project — each authenticated by its OWN api key so
  // the personal-vs-shared contract is exercised at the credential layer.
  let seededProject: { id: string; apiKey: string };
  let emptyProject: { id: string; apiKey: string };
  let sharedProject: { id: string; apiKey: string };
  // A second user's personal project + a user-bound key for the first user,
  // to prove the ownership guard (caller must own the project it targets).
  let otherUsersPersonalProjectId: string;
  let callerUserToken: string;

  // Ingestion-source fixtures: a hidden Governance Project (where PRINCIPAL
  // ledger rows land), plus a dedicated user + personal project so the
  // ledger seed doesn't perturb the seededProject assertions above.
  let governanceProjectId: string;
  let ingestionProject: { id: string; apiKey: string };
  let ingestionUserId: string;
  const foreignGovTenantId = `project_foreign_gov_${nanoid(8)}`;

  // Deterministic window around the seeded in-window trace.
  const inWindow = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
  const outOfWindow = new Date(Date.UTC(2025, 11, 15, 12, 0, 0));
  const windowStartMs = Date.UTC(2026, 0, 1);
  const windowEndMs = Date.UTC(2026, 0, 31);

  const authHeaders = ({ apiKey, projectId }: { apiKey: string; projectId: string }) => ({
    Authorization: `Bearer ${apiKey}`,
    "X-Project-Id": projectId,
    "Content-Type": "application/json",
  });

  const makeProject = async ({
    name,
    isPersonal,
  }: {
    name: string;
    isPersonal: boolean;
  }) => {
    const apiKey = `sk-lw-${nanoid(48)}`;
    const project = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name,
        slug: `--test-${nanoid(8)}`,
        language: "typescript",
        framework: "other",
        apiKey,
        teamId: testTeam.id,
        isPersonal,
        ownerUserId: isPersonal ? userId : null,
      },
    });
    return { id: project.id, apiKey };
  };

  beforeAll(async () => {
    ch = getTestClickHouseClient();

    // The routes and workers under test take their ClickHouse repositories
    // from the App rather than resolving a client, so the fixture has to
    // provide one or they fail with "App not initialized".
    installClickHouseTestApp({
      resolveClient: async () => getTestClickHouseClient(),
    });
    testOrganization = await prisma.organization.create({
      data: { name: "Me Usage Test Org", slug: `--test-org-${ns}` },
    });
    testTeam = await prisma.team.create({
      data: {
        name: "Me Usage Test Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });
    const user = await prisma.user.create({
      data: { name: "Test User", email: `test-${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId, teamId: testTeam.id, role: TeamUserRole.ADMIN },
    });

    seededProject = await makeProject({
      name: "Personal Workspace",
      isPersonal: true,
    });
    emptyProject = await makeProject({
      name: "Empty Personal Workspace",
      isPersonal: true,
    });
    sharedProject = await makeProject({
      name: "Shared Project",
      isPersonal: false,
    });

    // A second user with their OWN personal project (owned by them, not the
    // caller). The caller gets an org-ADMIN role binding + a user-bound key, so
    // it can view this project (project:view) — the guard must still 403.
    const otherUser = await prisma.user.create({
      data: { name: "Other User", email: `other-${ns}@example.com` },
    });
    await prisma.organizationUser.create({
      data: {
        userId: otherUser.id,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const otherPersonal = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "Personal Workspace",
        slug: `--test-other-${nanoid(8)}`,
        language: "typescript",
        framework: "other",
        apiKey: `sk-lw-${nanoid(48)}`,
        teamId: testTeam.id,
        isPersonal: true,
        ownerUserId: otherUser.id,
      },
    });
    otherUsersPersonalProjectId = otherPersonal.id;

    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: testOrganization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });
    callerUserToken = (
      await getApp().apiKeys.apiKeyService.create({
        name: `me-usage-caller-${nanoid(6)}`,
        userId,
        createdByUserId: userId,
        organizationId: testOrganization.id,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: testOrganization.id,
          },
        ],
      })
    ).token;

    // Hidden Governance Project for the org — ingestion-source PRINCIPAL
    // ledger rows are written under this tenant (ingestionRoutes.ts).
    const governanceProject = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "Governance (internal)",
        slug: `governance-${testOrganization.id}`,
        language: "internal",
        framework: "governance",
        apiKey: `sk-lw-${nanoid(48)}`,
        teamId: testTeam.id,
        kind: "internal_governance",
        isPersonal: false,
        ownerUserId: null,
      },
    });
    governanceProjectId = governanceProject.id;

    // Dedicated ingestion user + personal project (keeps the seededProject
    // assertions above untouched).
    const ingestionUser = await prisma.user.create({
      data: { name: "Ingestion User", email: `ingest-${ns}@example.com` },
    });
    ingestionUserId = ingestionUser.id;
    await prisma.organizationUser.create({
      data: {
        userId: ingestionUserId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const ingestionApiKey = `sk-lw-${nanoid(48)}`;
    const ingestionProj = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "Ingestion Personal Workspace",
        slug: `--test-ingest-${nanoid(8)}`,
        language: "typescript",
        framework: "other",
        apiKey: ingestionApiKey,
        teamId: testTeam.id,
        isPersonal: true,
        ownerUserId: ingestionUserId,
      },
    });
    ingestionProject = { id: ingestionProj.id, apiKey: ingestionApiKey };

    if (ch) {
      // One trace inside the window, one outside — the window test proves the
      // out-of-window trace is excluded.
      await insertTrace({
        ch,
        tenantId: seededProject.id,
        traceId: `t-in-${nanoid(6)}`,
        occurredAt: inWindow,
        totalCost: 0.5,
        models: ["gpt-4o"],
      });
      await insertTrace({
        ch,
        tenantId: seededProject.id,
        traceId: `t-out-${nanoid(6)}`,
        occurredAt: outOfWindow,
        totalCost: 2.0,
        models: ["claude-opus-4-8"],
      });

      // Ingestion ledger for ingestionUser: one request under THIS org's
      // governance tenant (must count), one under a FOREIGN tenant (must be
      // excluded by the TenantId scope — the multi-org-leak guard), one under
      // the right tenant but OUT of window (must be excluded by time), and one
      // in scope that the provider failed (must be excluded by status, the way
      // every other ledger read excludes it).
      //
      // The in-window request writes TWO rows, because this user carries a
      // hard cap and a soft cap and the ledger files one row per applicable
      // budget. Both carry the request's full amount. Scope='principal'
      // narrows to the user, not to one row per request, so a read that
      // summed the rows as they sit would report double.
      //
      // The amount carries digits below a micro-USD on purpose: 300_000_123
      // nano is $0.300000123, which the `AmountUSD` decimal cannot hold. A
      // read that sums that column answers $0.300000, so the assertion below
      // fails for any read that goes back to summing it.
      const paidNanoUsd = 300_000_123;
      const pairedRequestId = `req-paired-${nanoid(8)}`;
      await insertLedgerRow({
        ch,
        tenantId: governanceProjectId,
        scopeId: ingestionUserId,
        amountNanoUsd: paidNanoUsd,
        model: "claude-sonnet-4-6",
        occurredAt: inWindow,
        gatewayRequestId: pairedRequestId,
      });
      await insertLedgerRow({
        ch,
        tenantId: governanceProjectId,
        scopeId: ingestionUserId,
        amountNanoUsd: paidNanoUsd,
        model: "claude-sonnet-4-6",
        occurredAt: inWindow,
        gatewayRequestId: pairedRequestId,
      });
      await insertLedgerRow({
        ch,
        tenantId: foreignGovTenantId,
        scopeId: ingestionUserId,
        amountNanoUsd: 99_000_000_000,
        model: "gpt-4o",
        occurredAt: inWindow,
      });
      await insertLedgerRow({
        ch,
        tenantId: governanceProjectId,
        scopeId: ingestionUserId,
        amountNanoUsd: 7_000_000_000,
        model: "claude-sonnet-4-6",
        occurredAt: outOfWindow,
      });
      await insertLedgerRow({
        ch,
        tenantId: governanceProjectId,
        scopeId: ingestionUserId,
        amountNanoUsd: 5_000_000_000,
        model: "gemini-3-pro",
        occurredAt: inWindow,
        status: "provider_error",
      });
    }
  });

  afterAll(async () => {
    await clearClickHouseTestApp();
    if (ch) {
      await cleanupTestData(seededProject.id).catch(() => {});
      // gateway_budget_ledger_events isn't covered by cleanupTestData.
      // Best-effort delete the rows this suite seeded (unique ScopeId per
      // run, so a lagging async mutation can't collide with other suites).
      await ch
        .command({
          query:
            "ALTER TABLE gateway_budget_ledger_events DELETE WHERE ScopeId = {scopeId:String}",
          query_params: { scopeId: ingestionUserId },
        })
        .catch(() => {});
    }
    await prisma.apiKey
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
    await prisma.roleBinding
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
    await prisma.project.deleteMany({ where: { teamId: testTeam.id } }).catch(() => {});
    await prisma.teamUser.deleteMany({ where: { teamId: testTeam.id } }).catch(() => {});
    const orgUsers = await prisma.organizationUser
      .findMany({ where: { organizationId: testOrganization.id } })
      .catch(() => []);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
    for (const ou of orgUsers) {
      await prisma.user.delete({ where: { id: ou.userId } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.team.delete({ where: { id: testTeam.id } }).catch(() => {});
    await prisma.organization
      .delete({ where: { id: testOrganization.id } })
      .catch(() => {});
  });

  describe("given no authentication", () => {
    describe("when reading usage", () => {
      /** @scenario "Unauthenticated requests are rejected" */
      it("returns 401", async () => {
        const headers = new Headers();
        headers.set("X-Project-Id", seededProject.id);
        const res = await app.request("/api/me/usage", { headers });
        expect(res.status).toBe(401);
      });
    });
  });

  describe("given a personal-workspace API key", () => {
    describe("when reading usage for the current month (default window)", () => {
      /** @scenario "Reading personal usage for the current month" */
      it("returns the usage envelope", async () => {
        const res = await app.request("/api/me/usage", {
          headers: authHeaders({
            apiKey: seededProject.apiKey,
            projectId: seededProject.id,
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.summary).toHaveProperty("spentUsd");
        expect(body.summary).toHaveProperty("billedUsd");
        expect(body.summary).toHaveProperty("requests");
        expect(body.summary).toHaveProperty("mostUsedModel");
        expect(Array.isArray(body.dailyBuckets)).toBe(true);
        expect(Array.isArray(body.breakdownByModel)).toBe(true);
      });
    });

    describe("when reading usage for an explicit window", () => {
      /** @scenario "Reading personal usage for an explicit window" */
      it("rolls up only usage inside the window", async () => {
        const res = await app.request(
          `/api/me/usage?windowStartMs=${windowStartMs}&windowEndMs=${windowEndMs}`,
          {
            headers: authHeaders({
              apiKey: seededProject.apiKey,
              projectId: seededProject.id,
            }),
          },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        // Only the in-window trace ($0.50, 1 request) counts; the $2.00
        // out-of-window trace is excluded.
        expect(body.summary.spentUsd).toBeCloseTo(0.5, 5);
        expect(body.summary.requests).toBe(1);
        expect(body.dailyBuckets.length).toBeGreaterThanOrEqual(1);
        const total = body.dailyBuckets.reduce(
          (sum: number, b: { spentUsd: number }) => sum + b.spentUsd,
          0,
        );
        expect(total).toBeCloseTo(0.5, 5);
        expect(body.breakdownByModel.map((m: { label: string }) => m.label)).toContain(
          "gpt-4o",
        );
      });
    });

    describe("when a half-specified window is provided", () => {
      /** @scenario "A half-specified window is rejected" */
      it("returns 400 explaining both bounds are required", async () => {
        const res = await app.request(`/api/me/usage?windowStartMs=${windowStartMs}`, {
          headers: authHeaders({
            apiKey: seededProject.apiKey,
            projectId: seededProject.id,
          }),
        });
        // 422: the window failed the query SCHEMA, so the validation boundary
        // reports it as unprocessable with the offending fields attached. 400
        // stays for a request the parser could not read at all.
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(JSON.stringify(body)).toContain("provided together");
      });
    });

    describe("when an inverted window is provided", () => {
      // "at or after the end time" — cover both start > end and start === end
      // so a regression from `<` to `<=` in the schema check can't slip through.
      const invertedCases: Array<{
        label: string;
        start: number;
        end: number;
      }> = [
        { label: "start after end", start: windowEndMs, end: windowStartMs },
        {
          label: "start equal to end",
          start: windowStartMs,
          end: windowStartMs,
        },
      ];

      for (const { label, start, end } of invertedCases) {
        /** @scenario "An inverted window is rejected" */
        it(`returns 400 explaining start must be before end (${label})`, async () => {
          const res = await app.request(
            `/api/me/usage?windowStartMs=${start}&windowEndMs=${end}`,
            {
              headers: authHeaders({
                apiKey: seededProject.apiKey,
                projectId: seededProject.id,
              }),
            },
          );
          expect(res.status).toBe(422);
          const body = await res.json();
          expect(JSON.stringify(body)).toContain("before");
        });
      }
    });

    describe("when the workspace has no usage in the window", () => {
      /** @scenario "Empty state is safe" */
      it("returns the empty-state envelope", async () => {
        const res = await app.request("/api/me/usage", {
          headers: authHeaders({
            apiKey: emptyProject.apiKey,
            projectId: emptyProject.id,
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.summary).toMatchObject({
          spentUsd: 0,
          billedUsd: 0,
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          mostUsedModel: null,
        });
        // dailyBuckets is dense (one zero-filled bucket per day in the
        // window via fillEmptyBuckets), so empty-state means every bucket is
        // zero — not an empty array.
        expect(body.dailyBuckets.length).toBeGreaterThan(0);
        expect(
          body.dailyBuckets.every(
            (b: { spentUsd: number; requests: number }) =>
              b.spentUsd === 0 && b.requests === 0,
          ),
        ).toBe(true);
        expect(body.breakdownByModel).toEqual([]);
      });
    });
  });

  describe("given a user-bound key that can view another user's personal workspace", () => {
    describe("when reading that other user's usage", () => {
      /** @scenario "A key cannot read another user's personal usage" */
      it("returns the key mismatch code, not just project:view", async () => {
        const res = await app.request("/api/me/usage", {
          headers: authHeaders({
            apiKey: callerUserToken,
            projectId: otherUsersPersonalProjectId,
          }),
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        // The code is the contract; the sentence beside it is copy.
        expect(body.error).toBe("personal_usage_key_mismatch");
      });
    });

    describe("when reading their OWN personal workspace", () => {
      /** @scenario "Reading personal usage for the current month" */
      it("returns 200 (caller is the owner)", async () => {
        const res = await app.request("/api/me/usage", {
          headers: authHeaders({
            apiKey: callerUserToken,
            projectId: seededProject.id,
          }),
        });
        expect(res.status).toBe(200);
      });
    });
  });

  describe("given ingestion-source spend in the org's governance tenant", () => {
    describe("when reading usage for the explicit window", () => {
      /** @scenario "Ingestion-source spend is included and scoped to this organization" */
      it("unions only this org's governance-tenant rows, excluding foreign tenants", async () => {
        const res = await app.request(
          `/api/me/usage?windowStartMs=${windowStartMs}&windowEndMs=${windowEndMs}`,
          {
            headers: authHeaders({
              apiKey: ingestionProject.apiKey,
              projectId: ingestionProject.id,
            }),
          },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        // Only the in-org, in-window, successful request counts. The $99
        // foreign-tenant row is excluded by the TenantId scope (the multi-org
        // leak guard), the $7 out-of-window row by time, and the $5
        // provider_error row by status. The two budget rows that one request
        // wrote count once between them: double here would mean a user's own
        // dashboard inflates their spend by however many budgets happen to
        // watch them.
        //
        // Exact, not close: the amount has digits below a micro-USD, so a
        // read that summed the `AmountUSD` decimal would answer 0.3 and this
        // is the assertion that says so.
        expect(body.summary.spentUsd).toBe(0.300000123);
        expect(body.summary.requests).toBe(1);
        const labels = body.breakdownByModel.map((m: { label: string }) => m.label);
        expect(labels).toContain("claude-sonnet-4-6");
        // gpt-4o only appears on the foreign-tenant row — proves exclusion.
        expect(labels).not.toContain("gpt-4o");
        // gemini-3-pro only appears on the failed row — proves the status
        // filter, which every other ledger spend read applies.
        expect(labels).not.toContain("gemini-3-pro");
      });
    });
  });

  describe("given a shared (non-personal) workspace API key", () => {
    describe("when reading usage", () => {
      /** @scenario "A shared-workspace API key is rejected" */
      it("returns the personal-workspace key required code", async () => {
        const res = await app.request("/api/me/usage", {
          headers: authHeaders({
            apiKey: sharedProject.apiKey,
            projectId: sharedProject.id,
          }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("personal_project_key_required");
        // Nothing on the wire names how the check is made: the refusal has to
        // stay readable by whoever holds the key, not by whoever wrote the row.
        expect(JSON.stringify(body)).not.toContain("isPersonal");
      });
    });
  });
});
