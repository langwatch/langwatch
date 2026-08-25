import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BugReport } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { app } from "~/server/routes/bug-reports";
import { BugReportRateLimitedError, submitBugReport } from "../bug-report.service";

/**
 * Integration tests for the bug-report intake, against the real
 * database and the real Hono route. Corresponds to the scenarios in
 * specs/support/agent-issue-reports.feature.
 */
describe("bug reports intake", () => {
  const testNamespace = `agent-report-int-${nanoid(8)}`;
  const createdReportIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdOrgIds: string[] = [];

  const trackReport = (id: string) => {
    createdReportIds.push(id);
    return id;
  };

  const postReport = async (
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
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

  afterAll(async () => {
    await prisma.bugReport.deleteMany({
      where: { id: { in: createdReportIds } },
    });
    for (const id of createdProjectIds)
      await prisma.project.delete({ where: { id } }).catch(() => void 0);
    for (const id of createdTeamIds)
      await prisma.team.delete({ where: { id } }).catch(() => void 0);
    for (const id of createdOrgIds)
      await prisma.organization.delete({ where: { id } }).catch(() => void 0);
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
        data: {
          name: `${testNamespace} org`,
          slug: `${testNamespace}-org`,
        },
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
      legacyApiKey = `${testNamespace}-key-${nanoid(16)}`;
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
      const response = await postReport(baseReport(), {
        "x-auth-token": legacyApiKey,
      });
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
      const response = await postReport(baseReport(), {
        "x-auth-token": "sk-lw-definitely-not-a-real-key-000000",
      });
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
      // The default notifier reads SLACK_BUG_REPORTS_BOT_TOKEN, unset in
      // tests, and returns before touching any transport.
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        const { id } = await submitBugReport({
          input: {
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
          let hostname: string;
          try {
            hostname = new URL(target).hostname;
          } catch {
            return false;
          }
          return hostname === "slack.com" || hostname.endsWith(".slack.com");
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
  });

  describe("when the caller exceeds the rate limit", () => {
    /** @scenario "Submissions are rate limited per client" */
    it("rejects further reports for that caller only", async () => {
      const callerKey = `ratelimit-${testNamespace}`;
      const submitOnce = () =>
        submitBugReport({
          input: {
            source: "cli",
            kind: "summary",
            title: `${testNamespace} rate limited`,
            summary: "spam",
          },
          callerKey,
          notify: async () => void 0,
        });

      for (let i = 0; i < 10; i++) {
        const { id } = await submitOnce();
        trackReport(id);
      }
      await expect(submitOnce()).rejects.toThrow(BugReportRateLimitedError);

      const other = await submitBugReport({
        input: {
          source: "cli",
          kind: "summary",
          title: `${testNamespace} other caller`,
          summary: "fine",
        },
        callerKey: `other-${testNamespace}`,
        notify: async () => void 0,
      });
      trackReport(other.id);
    });
  });

  describe("when the team alert is delivered", () => {
    /** @scenario "The team is notified on Slack for each new report" */
    it("passes the stored report to the notifier", async () => {
      const notified: BugReport[] = [];
      const { id } = await submitBugReport({
        input: {
          source: "mcp",
          kind: "summary",
          title: `${testNamespace} notified`,
          summary: "notify me",
        },
        callerKey: `notify-${testNamespace}`,
        notify: async ({ report }) => {
          notified.push(report);
        },
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
      const { id } = await submitBugReport({
        input: {
          source: "cli",
          kind: "summary",
          title: `${testNamespace} slack down`,
          summary: "still stored",
        },
        callerKey: `slackdown-${testNamespace}`,
        notify: async () => {
          throw new Error("slack unavailable");
        },
      });
      trackReport(id);
      const stored = await prisma.bugReport.findUnique({ where: { id } });
      expect(stored?.title).toBe(`${testNamespace} slack down`);
    });
  });
});
