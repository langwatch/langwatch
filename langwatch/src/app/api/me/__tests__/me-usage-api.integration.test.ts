import type { ClickHouseClient } from "@clickhouse/client";
import {
  type Organization,
  OrganizationUserRole,
  type Team,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { app } from "../[[...route]]/app";

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

  // Deterministic window around the seeded in-window trace.
  const inWindow = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
  const outOfWindow = new Date(Date.UTC(2025, 11, 15, 12, 0, 0));
  const windowStartMs = Date.UTC(2026, 0, 1);
  const windowEndMs = Date.UTC(2026, 0, 31);

  const authHeaders = ({
    apiKey,
    projectId,
  }: {
    apiKey: string;
    projectId: string;
  }) => ({
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
    }
  });

  afterAll(async () => {
    if (ch) {
      await cleanupTestData(seededProject.id).catch(() => {});
    }
    await prisma.project
      .deleteMany({ where: { teamId: testTeam.id } })
      .catch(() => {});
    await prisma.teamUser
      .deleteMany({ where: { teamId: testTeam.id } })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
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
        expect(
          body.breakdownByModel.map((m: { label: string }) => m.label),
        ).toContain("gpt-4o");
      });
    });

    describe("when a half-specified window is provided", () => {
      /** @scenario "A half-specified window is rejected" */
      it("returns 400 explaining both bounds are required", async () => {
        const res = await app.request(
          `/api/me/usage?windowStartMs=${windowStartMs}`,
          {
            headers: authHeaders({
              apiKey: seededProject.apiKey,
              projectId: seededProject.id,
            }),
          },
        );
        expect(res.status).toBe(400);
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
          expect(res.status).toBe(400);
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

  describe("given a shared (non-personal) workspace API key", () => {
    describe("when reading usage", () => {
      /** @scenario "A shared-workspace API key is rejected" */
      it("returns 400 explaining a personal-workspace key is required", async () => {
        const res = await app.request("/api/me/usage", {
          headers: authHeaders({
            apiKey: sharedProject.apiKey,
            projectId: sharedProject.id,
          }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(JSON.stringify(body)).toContain("personal-project");
      });
    });
  });
});
