import { type AlertType, type Project, TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerContext } from "../../types";
import { handleSendEmail } from "../sendEmail";

vi.mock("~/server/mailer/triggerEmail", () => ({
  sendRenderedTriggerEmail: vi.fn(),
}));

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendRenderedSlackMessage: vi.fn(),
}));

vi.mock("~/server/triggers/slackWebApi", () => ({
  postSlackChatMessage: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const filterSuppressed = vi.fn();
const isSendClaimed = vi.fn().mockResolvedValue(false);
const claimSend = vi.fn().mockResolvedValue(true);
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    emailSuppressions: { filterSuppressed },
    // The cron path backs the mailer's per-recipient idempotency gate with the
    // same TriggerSent claim store the outbox path uses, reached via
    // getApp().triggers — so a mid-loop failure doesn't re-send on the next tick.
    triggers: { isSendClaimed, claimSend },
  }),
}));

const consumeEmailCapSlot = vi.fn();
const consumeTenantEmailCapSlot = vi.fn();
vi.mock("~/server/event-sourcing/outbox/emailHourlyCap", () => ({
  consumeEmailCapSlot: (...args: unknown[]) => consumeEmailCapSlot(...args),
  consumeTenantEmailCapSlot: (...args: unknown[]) =>
    consumeTenantEmailCapSlot(...args),
}));

import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { captureException } from "~/utils/posthogErrorCapture";

const PROJECT: Project = {
  id: "project-1",
  name: "Demo",
  slug: "test-project",
} as unknown as Project;

function makeContext({
  members,
  alertType = "CRITICAL" as AlertType,
  emailSubjectTemplate = null,
  emailBodyTemplate = null,
  previousFireId = null,
}: {
  members?: string[];
  alertType?: AlertType | null;
  emailSubjectTemplate?: string | null;
  emailBodyTemplate?: string | null;
  previousFireId?: string | null;
}): TriggerContext {
  return {
    trigger: {
      id: "trigger-1",
      projectId: "project-1",
      name: "Test Trigger",
      action: TriggerAction.SEND_EMAIL,
      actionParams: members ? { members } : {},
      alertType,
      message: "Custom alert message",
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate,
      emailBodyTemplate,
    } as any,
    projects: [PROJECT],
    triggerData: [],
    projectSlug: "test-project",
    graphAlert: {
      graph: { id: "graph-1", name: "Latency p95" },
      metric: { label: "Latency p95", seriesName: "0/duration/p95" },
      condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
      currentValue: 712,
      window: {
        start: new Date("2026-06-21T09:00:00Z"),
        end: new Date("2026-06-21T10:00:00Z"),
      },
      occurredAt: new Date("2026-06-21T10:00:00Z"),
      previousFireId,
    },
  };
}

describe("handleSendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing suppressed, under both caps.
    filterSuppressed.mockImplementation(
      async ({ emails }: { emails: string[] }) => emails,
    );
    consumeEmailCapSlot.mockResolvedValue({ allowed: true, count: 1 });
    consumeTenantEmailCapSlot.mockResolvedValue({ allowed: true, count: 1 });
    isSendClaimed.mockResolvedValue(false);
    claimSend.mockResolvedValue(true);
  });

  describe("when email is sent successfully", () => {
    it("reports the fire as consumed (didSend true)", async () => {
      const result = await handleSendEmail(
        makeContext({ members: ["user@example.com"] }),
      );

      expect(result).toEqual({ didSend: true });
    });

    it("renders the alert templates and mails every recipient", async () => {
      await handleSendEmail(
        makeContext({ members: ["user1@example.com", "user2@example.com"] }),
      );

      expect(sendRenderedTriggerEmail).toHaveBeenCalledTimes(1);
      const call = vi.mocked(sendRenderedTriggerEmail).mock.calls[0]?.[0] as {
        triggerEmails: string[];
        triggerId: string;
        projectId: string;
        subject: string;
        html: string;
        isRecipientSent?: (hash: string) => Promise<boolean>;
        recordRecipientSent?: (hash: string) => Promise<void>;
      };
      expect(call.triggerEmails).toEqual([
        "user1@example.com",
        "user2@example.com",
      ]);
      expect(call.triggerId).toBe("trigger-1");
      expect(call.projectId).toBe("project-1");
      expect(call.isRecipientSent).toEqual(expect.any(Function));
      expect(call.recordRecipientSent).toEqual(expect.any(Function));
    });
  });

  // Regression (dispatch5015-P1, Finding 2): the cron used to call the legacy
  // `sendTriggerEmail` React tree and never read the trigger's Liquid template
  // columns. With the firing flag OFF — the shipped default — an author's saved
  // template, and the alert-shaped copy they previewed in the drawer, were
  // silently dropped at send time.
  describe("given the alert defaults (no custom template)", () => {
    it("renders the metric-crossed-threshold subject, not the legacy trace subject", async () => {
      await handleSendEmail(makeContext({ members: ["user@example.com"] }));

      const call = vi.mocked(sendRenderedTriggerEmail).mock.calls[0]?.[0] as {
        subject: string;
        html: string;
      };
      expect(call.subject).toBe(
        "[Alert] Test Trigger — Latency p95 is greater than 500",
      );
      expect(call.html).toContain("Latency p95");
      expect(call.html).toContain("712");
    });
  });

  describe("given a trigger with custom email templates", () => {
    it("renders the author's Liquid instead of the defaults", async () => {
      await handleSendEmail(
        makeContext({
          members: ["user@example.com"],
          emailSubjectTemplate:
            "Custom: {{ trigger.name }} hit {{ currentValue }}",
          emailBodyTemplate:
            "## Heads up\n\n{{ metric.label }} vs {{ condition.threshold }}",
        }),
      );

      const call = vi.mocked(sendRenderedTriggerEmail).mock.calls[0]?.[0] as {
        subject: string;
        html: string;
      };
      expect(call.subject).toBe("Custom: Test Trigger hit 712");
      expect(call.html).toContain("<h2>Heads up</h2>");
      expect(call.html).toContain("Latency p95");
      expect(call.html).toContain("500");
    });
  });

  describe("when action params has no members", () => {
    it("skips the send without consulting the cap and reports didSend false", async () => {
      const result = await handleSendEmail(makeContext({}));

      expect(sendRenderedTriggerEmail).not.toHaveBeenCalled();
      expect(consumeEmailCapSlot).not.toHaveBeenCalled();
      // Config-only drop: nothing was delivered, so the caller must not
      // record the incident.
      expect(result).toEqual({ didSend: false });
    });
  });

  describe("when some recipients are suppressed", () => {
    it("only sends to the surviving recipients", async () => {
      filterSuppressed.mockResolvedValue(["keep@example.com"]);

      await handleSendEmail(
        makeContext({ members: ["keep@example.com", "gone@example.com"] }),
      );

      expect(sendRenderedTriggerEmail).toHaveBeenCalledWith(
        expect.objectContaining({ triggerEmails: ["keep@example.com"] }),
      );
    });
  });

  describe("when the trigger is over its hourly cap", () => {
    it("drops the dispatch without sending but still reports didSend true", async () => {
      consumeEmailCapSlot.mockResolvedValueOnce({ allowed: false, count: 101 });

      const result = await handleSendEmail(
        makeContext({ members: ["user@example.com"] }),
      );

      expect(sendRenderedTriggerEmail).not.toHaveBeenCalled();
      // Hourly cap drops first; the project daily cap is never reached.
      expect(consumeTenantEmailCapSlot).not.toHaveBeenCalled();
      // Cap-exhausted counts as consumed: the caller opens the incident,
      // matching the event-sourced path, so a flapping metric cannot re-arm
      // the alert while the cap is exhausted.
      expect(result).toEqual({ didSend: true });
    });
  });

  describe("when the project is over its daily email cap (ADR-031)", () => {
    it("consults the daily cap by recipient count and drops without sending", async () => {
      consumeTenantEmailCapSlot.mockResolvedValueOnce({
        allowed: false,
        count: 10001,
      });

      await handleSendEmail(
        makeContext({ members: ["a@example.com", "b@example.com"] }),
      );

      // The daily cap counts RECIPIENTS, so recipientCount is the surviving
      // recipient-list length.
      expect(consumeTenantEmailCapSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          recipientCount: 2,
        }),
      );
      expect(sendRenderedTriggerEmail).not.toHaveBeenCalled();
    });
  });

  describe("when the per-recipient idempotency callbacks are passed to the mailer", () => {
    it("backs them with the TriggerSent claim store under a rcpt:-prefixed key", async () => {
      await handleSendEmail(makeContext({ members: ["user@example.com"] }));

      const args = vi.mocked(sendRenderedTriggerEmail).mock.calls[0]?.[0];
      // Invoke the wired callbacks the way the mailer would and assert they
      // delegate to getApp().triggers with the rcpt:-prefixed dedup key.
      await args!.isRecipientSent!("deadbeefdeadbeef");
      await args!.recordRecipientSent!("deadbeefdeadbeef");

      expect(isSendClaimed).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        projectId: "project-1",
        traceId: expect.stringMatching(/^rcpt:[0-9a-f]{16}:deadbeefdeadbeef$/),
      });
      const readKey = isSendClaimed.mock.calls[0]?.[0];
      const writeKey = claimSend.mock.calls[0]?.[0];
      // Read and write must target the SAME key, or a retry would never see
      // the recorded delivery.
      expect(writeKey).toEqual(readKey);
    });

    // Regression: the dispatch digest used to hash `traceId ?? graphId`, and a
    // graph alert's only "match" IS the graph — so the key was constant for the
    // life of the graph and, after the very first fire, every recipient was
    // permanently claimed. Keying on the fire generation moves the digest
    // forward with each delivered incident.
    describe("when the alert fires a second time", () => {
      it("keys the ledger under a different digest, so recipients are not permanently claimed", async () => {
        await handleSendEmail(
          makeContext({ members: ["user@example.com"], previousFireId: null }),
        );
        const first = vi.mocked(sendRenderedTriggerEmail).mock.calls[0]?.[0];
        await first!.recordRecipientSent!("deadbeefdeadbeef");
        const firstKey = (claimSend.mock.calls[0]?.[0] as { traceId: string })
          .traceId;

        await handleSendEmail(
          makeContext({
            members: ["user@example.com"],
            previousFireId: "sent-1",
          }),
        );
        const second = vi.mocked(sendRenderedTriggerEmail).mock.calls[1]?.[0];
        await second!.recordRecipientSent!("deadbeefdeadbeef");
        const secondKey = (claimSend.mock.calls[1]?.[0] as { traceId: string })
          .traceId;

        expect(secondKey).not.toBe(firstKey);
      });
    });
  });

  describe("when the mailer throws an error", () => {
    it("captures the exception and reports didSend false so the caller does not record the incident", async () => {
      const error = new Error("Email send failed");
      vi.mocked(sendRenderedTriggerEmail).mockRejectedValue(error);

      const result = await handleSendEmail(
        makeContext({ members: ["user@example.com"] }),
      );

      expect(result).toEqual({ didSend: false });
      expect(captureException).toHaveBeenCalledWith(error, {
        extra: {
          triggerId: "trigger-1",
          projectId: "project-1",
          action: TriggerAction.SEND_EMAIL,
        },
      });
    });
  });
});
