import type { BugReport } from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { HttpSlackAlertChannel, type SlackAlertFetch } from "../http/http.slack-alert.channel.ts";
import { SlackBugReportNotifierChannel } from "../slack/slack.bug-report-notifier.channel.ts";

const BOT = "bot-token-marker";

function report(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: "report-1",
    createdAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
    source: "cli",
    kind: "summary",
    title: "Setup fails",
    summary: "the install step exits early",
    sessionData: null,
    sessionTruncated: false,
    agent: "claude-code",
    contactEmail: null,
    cliVersion: null,
    linkedProjectId: null,
    metadata: null,
    ...overrides,
  };
}

function slackAnswering(body: unknown, status = 200) {
  return vi.fn<SlackAlertFetch>(async () => Response.json(body, { status }));
}

function notifierOver({
  send,
  tokenConfigured = true,
}: {
  send: SlackAlertFetch;
  tokenConfigured?: boolean;
}) {
  return SlackBugReportNotifierChannel.create({
    transport: HttpSlackAlertChannel.create({ fetch: send }),
    config: {
      botToken: tokenConfigured ? BOT : undefined,
      channel: "#bugs",
      baseHost: "https://app.example.test/",
    },
  });
}

describe("given Slack notification credentials are configured", () => {
  describe("when a new report is stored", () => {
    /** @scenario "The team is notified on Slack for each new report" */
    it("posts the title, agent, kind, excerpt and admin link to the configured channel", async () => {
      const send = slackAnswering({ ok: true });

      await notifierOver({ send }).notify({ report: report() });

      const [url, init] = send.mock.calls[0] ?? [];
      expect(url).toBe("https://slack.com/api/chat.postMessage");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${BOT}`);
      expect(init?.redirect).toBe("error");
      const posted = JSON.parse(init?.body as string) as { channel: string; blocks: unknown[] };
      expect(posted.channel).toBe("#bugs");
      const text = JSON.stringify(posted.blocks);
      expect(text).toContain("Setup fails");
      expect(text).toContain("claude-code");
      expect(text).toContain("*Kind:* summary");
      expect(text).toContain("the install step exits early");
      expect(text).toContain("https://app.example.test/ops/cloud/bug-reports?report=report-1");
    });
  });

  describe("when Slack refuses the message", () => {
    /** @scenario "Slack failures never fail the report intake" */
    it("rejects with the Slack error code, for the intake to log and carry on", async () => {
      const send = slackAnswering({ ok: false, error: "channel_not_found" });

      await expect(notifierOver({ send }).notify({ report: report() })).rejects.toThrow(
        /channel_not_found/,
      );
    });

    it("rejects on a server error before reading a body", async () => {
      const send = slackAnswering({}, 503);

      await expect(notifierOver({ send }).notify({ report: report() })).rejects.toThrow(/HTTP 503/);
    });
  });
});

describe("given Slack notification credentials are not configured", () => {
  describe("when a new report is stored", () => {
    /** @scenario "Missing Slack configuration never blocks intake" */
    it("attempts no Slack call", async () => {
      const send = slackAnswering({ ok: true });

      await notifierOver({ send, tokenConfigured: false }).notify({ report: report() });

      expect(send).not.toHaveBeenCalled();
    });
  });
});
