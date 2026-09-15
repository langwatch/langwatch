/**
 * The bug-report intake, against the real database, the real declaration and
 * the real application. Corresponds to specs/support/bug-reports.feature.
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { BugReport } from "@langwatch/ops-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { BugReportNotifier, BugReportRateLimiter } from "../../app/ops.app.ts";
import { createOpsTestApp } from "../../app/__tests__/ops.fixture.ts";
import { PrismaBugReportRepository } from "../../repositories/prisma/prisma.bug-report.repository.ts";
import { BugReportRateLimitedError } from "../../services/bug-report-intake.service.ts";
import { bugReportCredential, opsBugReportRest } from "../ops-bug-report.rest.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/** In-process fixed-window limiter, one bucket per callerKey, per test run. */
function inMemoryRateLimiter(): BugReportRateLimiter {
  const counts = new Map<string, number>();

  return {
    consume: async ({ key, max }) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);

      return { allowed: next <= max };
    },
  };
}

function silentNotifier(): BugReportNotifier {
  return { notify: async () => void 0 };
}

describe.skipIf(!DB_URL)("bug reports intake", () => {
  let connection: PrismaConnection;
  let prisma: PrismaClient;
  let repository: PrismaBugReportRepository;
  const testNamespace = `agent-report-int-${randomUUID().slice(0, 8)}`;
  const createdReportIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdOrgIds: string[] = [];

  const trackReport = (id: string) => {
    createdReportIds.push(id);

    return id;
  };

  beforeAll(() => {
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    repository = PrismaBugReportRepository.create({ prisma });
  });

  afterAll(async () => {
    await prisma.bugReport.deleteMany({ where: { id: { in: createdReportIds } } });
    for (const id of createdProjectIds)
      await prisma.project.delete({ where: { id } }).catch(() => void 0);
    for (const id of createdTeamIds)
      await prisma.team.delete({ where: { id } }).catch(() => void 0);
    for (const id of createdOrgIds)
      await prisma.organization.delete({ where: { id } }).catch(() => void 0);
    await prisma.$disconnect();
  });

  /** The application, over the real rows and whatever the test wants watched. */
  function opsApp(
    options: {
      apiKeys?: ApiKeyApi;
      rateLimiter?: BugReportRateLimiter;
      notifier?: BugReportNotifier;
    } = {},
  ) {
    const { app } = createOpsTestApp({
      repositories: { bugReports: repository },
      ...(options.apiKeys ? { apiKeys: options.apiKeys } : {}),
      members: {
        bugReportRateLimiter: options.rateLimiter ?? inMemoryRateLimiter(),
        bugReportNotifier: options.notifier ?? silentNotifier(),
      },
    });

    return app;
  }

  function mountApp(options: { apiKeys?: ApiKeyApi } = {}) {
    const app = opsApp(options);
    const runtime = createRestRuntime({
      identity: {
        authenticate: () => {
          throw new Error("The intake resolves its own credential.");
        },
      },
    });

    return runtime.mount(opsBugReportRest.router(), {
      app: () => app,
      credential: "public",
      onError: (error, context) => context.json({ error: String(error) }, 500),
      facts: [
        bindRestMiddleware(bugReportCredential, (request) => {
          const token = request.headers.get("x-auth-token");

          return token ? { token, projectId: null } : null;
        }),
      ],
    });
  }

  const postReport = async (
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
    app = mountApp(),
  ) =>
    app.request("/api/bug-reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Distinct caller per namespace so the rate limiter never bleeds
        // between test runs.
        "x-forwarded-for": `test-${testNamespace}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const baseReport = () => ({
    source: "cli",
    kind: "summary",
    title: `${testNamespace} scenario create 500`,
    summary: "running scenario create returned a 500 with no body",
    agent: "claude-code",
    cliVersion: "0.36.0",
  });

  describe("when a summary report arrives without credentials", () => {
    /** @scenario "A summary report is stored" */
    /** @scenario "Reports do not require authentication" */
    it("stores it under a prefixed id and returns it", async () => {
      const response = await postReport(baseReport());
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      trackReport(id);
      expect(id).toMatch(/^bugreport_/);

      const stored = await prisma.bugReport.findUnique({ where: { id } });
      expect(stored?.title).toBe(`${testNamespace} scenario create 500`);
      expect(stored?.source).toBe("cli");
      expect(stored?.kind).toBe("summary");
      expect(stored?.agent).toBe("claude-code");
      expect(stored?.linkedProjectId).toBeNull();
    });
  });

  describe("when a raw submission carries secrets, bypassing client redaction", () => {
    /** @scenario "Submitted content is redacted again on the platform before storage" */
    it("stores every field redacted", async () => {
      const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
      const response = await postReport({
        source: "cli",
        kind: "full_session",
        title: `${testNamespace} leaked ${key}`,
        summary: `the key ${key} appeared in the summary`,
        sessionData: JSON.stringify({ content: `curl -H 'Bearer ${key}'` }),
        metadata: { command: `langwatch login --api-key ${key}` },
      });
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      trackReport(id);

      const stored = await prisma.bugReport.findUnique({ where: { id } });
      const wire = JSON.stringify(stored);
      expect(wire).not.toContain(key);
      expect(stored?.title).toContain("[SECRET]");
      expect(stored?.summary).toContain("[SECRET]");
      expect(stored?.sessionData).toContain("[SECRET]");
      expect(JSON.stringify(stored?.metadata)).toContain("[SECRET]");
    });
  });

  describe("when a full session report arrives", () => {
    /** @scenario "A full session report is stored with its transcript" */
    it("stores the transcript", async () => {
      const sessionData = '{"role":"user","content":"it broke"}';
      const response = await postReport({
        ...baseReport(),
        kind: "full_session",
        sessionData,
        sessionTruncated: true,
      });
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      trackReport(id);

      const stored = await prisma.bugReport.findUnique({ where: { id } });
      expect(stored?.sessionData).toBe(sessionData);
      expect(stored?.sessionTruncated).toBe(true);
    });
  });

  describe("when a valid project API key is presented", () => {
    let projectId: string;
    let legacyApiKey: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `${testNamespace} org`, slug: `${testNamespace}-org` },
      });
      createdOrgIds.push(organization.id);
      const team = await prisma.team.create({
        data: {
          name: `${testNamespace} team`,
          slug: `${testNamespace}-team`,
          organizationId: organization.id,
        },
      });
      createdTeamIds.push(team.id);
      legacyApiKey = `${testNamespace}-key-${randomUUID().slice(0, 16)}`;
      const project = await prisma.project.create({
        data: {
          name: `${testNamespace} project`,
          slug: `${testNamespace}-project`,
          teamId: team.id,
          language: "python",
          framework: "openai",
          apiKey: legacyApiKey,
        },
      });
      createdProjectIds.push(project.id);
      projectId = project.id;
    });

    /** @scenario "Reports with a valid project API key are linked to the project" */
    it("links the report to the project", async () => {
      const app = mountApp({
        apiKeys: createApiFixture<ApiKeyApi>({
          findResolvedToken: async ({ token }) =>
            token === legacyApiKey ? ({ project: { id: projectId } } as never) : null,
        }),
      });
      const response = await postReport(baseReport(), { "x-auth-token": legacyApiKey }, app);
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      trackReport(id);

      const stored = await prisma.bugReport.findUnique({ where: { id } });
      expect(stored?.linkedProjectId).toBe(projectId);
    });
  });

  describe("when an invalid API key is presented", () => {
    /** @scenario "Reports with an invalid API key are still accepted, unlinked" */
    it("still accepts the report, unlinked", async () => {
      const app = mountApp({
        apiKeys: createApiFixture<ApiKeyApi>({ findResolvedToken: async () => null }),
      });
      const response = await postReport(
        baseReport(),
        { "x-auth-token": "sk-lw-definitely-not-a-real-key-000000" },
        app,
      );
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      trackReport(id);

      const stored = await prisma.bugReport.findUnique({ where: { id } });
      expect(stored?.linkedProjectId).toBeNull();
    });
  });

  describe("when the payload exceeds the size limit", () => {
    /** @scenario "Oversized payloads are rejected" */
    it("rejects it with a payload-too-large response", async () => {
      const response = await postReport({
        ...baseReport(),
        kind: "full_session",
        sessionData: "x".repeat(13 * 1024 * 1024),
      });
      expect(response.status).toBe(413);
    });
  });

  describe("when Slack credentials are not configured", () => {
    /** @scenario "Missing Slack configuration never blocks intake" */
    it("stores the report without attempting a Slack call", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      try {
        const { id } = await opsApp().submitBugReport({
          report: {
            source: "cli",
            kind: "summary",
            title: `${testNamespace} no slack configured`,
            summary: "stored fine",
          },
          callerKey: `noslack-${testNamespace}`,
        });
        trackReport(id);
        const stored = await prisma.bugReport.findUnique({ where: { id } });
        expect(stored?.title).toBe(`${testNamespace} no slack configured`);
        const slackCalls = fetchSpy.mock.calls.filter((call) => {
          const target = call[0] instanceof Request ? call[0].url : String(call[0]);

          try {
            const hostname = new URL(target).hostname;

            return hostname === "slack.com" || hostname.endsWith(".slack.com");
          } catch {
            return false;
          }
        });
        expect(slackCalls).toHaveLength(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe("when the submission is malformed", () => {
    /** @scenario "Malformed submissions are rejected with validation errors" */
    it("rejects a report without any content", async () => {
      const response = await postReport({
        source: "cli",
        kind: "summary",
        title: "no content at all",
      });
      expect(response.status).toBe(400);
    });

    it("rejects a report without a title", async () => {
      const response = await postReport({
        source: "cli",
        kind: "summary",
        summary: "something broke",
      });
      expect(response.status).toBe(400);
    });

    it("rejects a body that is not JSON at all", async () => {
      const app = mountApp();
      const response = await app.request("/api/bug-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid body, expecting JSON",
      });
    });
  });

  describe("when the caller exceeds the rate limit", () => {
    /** @scenario "Submissions are rate limited per client" */
    it("rejects further reports for that caller only", async () => {
      const rateLimiter = inMemoryRateLimiter();
      const app = opsApp({ rateLimiter });
      const callerKey = `ratelimit-${testNamespace}`;
      const submitOnce = () =>
        app.submitBugReport({
          report: {
            source: "cli",
            kind: "summary",
            title: `${testNamespace} rate limited`,
            summary: "spam",
          },
          callerKey,
        });

      for (let i = 0; i < 10; i++) {
        const { id } = await submitOnce();
        trackReport(id);
      }
      await expect(submitOnce()).rejects.toThrow(BugReportRateLimitedError);

      const other = await app.submitBugReport({
        report: {
          source: "cli",
          kind: "summary",
          title: `${testNamespace} other caller`,
          summary: "fine",
        },
        callerKey: `other-${testNamespace}`,
      });
      trackReport(other.id);
    });
  });

  describe("when the team alert is delivered", () => {
    /** @scenario "The team is notified on Slack for each new report" */
    it("passes the stored report to the notifier", async () => {
      const notified: BugReport[] = [];
      const { id } = await opsApp({
        notifier: {
          notify: async ({ report }) => {
            notified.push(report);
          },
        },
      }).submitBugReport({
        report: {
          source: "mcp",
          kind: "summary",
          title: `${testNamespace} notified`,
          summary: "notify me",
        },
        callerKey: `notify-${testNamespace}`,
      });
      trackReport(id);
      expect(notified).toHaveLength(1);
      expect(notified[0]?.id).toBe(id);
      expect(notified[0]?.title).toBe(`${testNamespace} notified`);
    });
  });

  describe("when the team alert fails", () => {
    /** @scenario "Slack failures never fail the report intake" */
    it("stores the report and succeeds anyway", async () => {
      const { id } = await opsApp({
        notifier: {
          notify: async () => {
            throw new Error("slack unavailable");
          },
        },
      }).submitBugReport({
        report: {
          source: "cli",
          kind: "summary",
          title: `${testNamespace} slack down`,
          summary: "still stored",
        },
        callerKey: `slackdown-${testNamespace}`,
      });
      trackReport(id);
      const stored = await prisma.bugReport.findUnique({ where: { id } });
      expect(stored?.title).toBe(`${testNamespace} slack down`);
    });
  });
});
