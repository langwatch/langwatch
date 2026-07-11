import type { Project, Trigger } from "@prisma/client";
import { TriggerAction } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildGraphAlertTemplateContext } from "~/shared/templating/templateContext";
import {
  dispatchGraphAlertAction,
  graphAlertFireDigest,
} from "../graphAlertActionDispatch";

const NOW = new Date("2026-06-21T10:00:00.000Z");

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: "trg_1",
    projectId: "proj_1",
    name: "High latency",
    action: TriggerAction.SEND_EMAIL,
    actionParams: {},
    filters: {},
    active: true,
    deleted: false,
    alertType: "WARNING",
    message: null,
    customGraphId: "graph_1",
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Trigger;
}

function makeProject(): Project {
  return {
    id: "proj_1",
    name: "Acme",
    slug: "acme",
  } as unknown as Project;
}

function makeContext() {
  return buildGraphAlertTemplateContext({
    trigger: { id: "trg_1", name: "High latency", alertType: "WARNING" },
    graph: { id: "graph_1", name: "Latency p95" },
    metric: { label: "Latency p95", seriesName: "0/duration/p95" },
    condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
    currentValue: 712,
    occurredAt: NOW,
    reason: "real-time",
    project: { id: "proj_1", name: "Acme", slug: "acme" },
    baseHost: "https://app.langwatch.ai",
  });
}

const FIRE_DIGEST = "0123456789abcdef";

/**
 * Stand-in for the TriggerSent claim store — an in-memory set of the keys the
 * dispatcher has recorded, so a test can dispatch twice and observe the
 * at-most-once gate exactly as the outbox retry would.
 */
function makeDeps() {
  const sendEmail = vi.fn<(payload: unknown) => Promise<void>>(
    async () => undefined,
  );
  const sendSlack = vi.fn<(payload: unknown) => Promise<void>>(
    async () => undefined,
  );
  const sendSlackBot = vi.fn<(payload: unknown) => Promise<void>>(
    async () => undefined,
  );
  // Pass-through suppression by default — individual tests override to
  // exercise the ADR-031 unsubscribe gate.
  const filterSuppressedRecipients = vi.fn(
    async ({ emails }: { emails: string[] }) => emails,
  );
  const claims = new Set<string>();
  const isRecipientSent = vi.fn(
    async ({ traceId }: { traceId: string }) => claims.has(traceId),
  );
  const recordRecipientSent = vi.fn(
    async ({ traceId }: { traceId: string }) => {
      claims.add(traceId);
    },
  );
  return {
    deps: {
      sendEmail,
      sendSlack,
      sendSlackBot,
      filterSuppressedRecipients,
      isRecipientSent,
      recordRecipientSent,
    } as unknown as Parameters<typeof dispatchGraphAlertAction>[0]["deps"],
    sendEmail,
    sendSlack,
    sendSlackBot,
    filterSuppressedRecipients,
    isRecipientSent,
    recordRecipientSent,
    claims,
  };
}

describe("dispatchGraphAlertAction", () => {
  describe("given a SEND_EMAIL trigger with recipients", () => {
    it("renders against the alert defaults and calls sendEmail with subject + html", async () => {
      const { deps, sendEmail, sendSlack } = makeDeps();
      const result = await dispatchGraphAlertAction({
        deps,
        input: {
          trigger: makeTrigger(),
          project: makeProject(),
          context: makeContext(),
          recipients: ["a@example.com", "b@example.com"],
          slackWebhook: null,
          fireDigest: FIRE_DIGEST,
        },
      });

      expect(result.channel).toBe("email");
      expect(result.didSend).toBe(true);
      expect(sendSlack).not.toHaveBeenCalled();
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const call = sendEmail.mock.calls[0]?.[0] as {
        triggerEmails: string[];
        triggerId: string;
        projectId: string;
        subject: string;
        html: string;
      };
      expect(call.triggerEmails).toEqual(["a@example.com", "b@example.com"]);
      expect(call.triggerId).toBe("trg_1");
      expect(call.projectId).toBe("proj_1");
      expect(call.subject).toBe(
        "[Alert] High latency — Latency p95 is greater than 500",
      );
      expect(call.html).toContain("Latency p95");
      expect(call.html).toContain("712");
    });

    // Regression (dispatch5015-P1): the event-sourced path must honour the
    // ADR-031 suppression list — the SAME one-click-unsubscribe the emails it
    // sends advertise. Before the fix it called sendEmail with the raw
    // recipient list, so unsubscribed recipients kept receiving alerts.
    describe("when some recipients are on the suppression list", () => {
      it("only sends to the recipients that survive suppression", async () => {
        const { deps, sendEmail, filterSuppressedRecipients } = makeDeps();
        filterSuppressedRecipients.mockResolvedValueOnce(["a@example.com"]);

        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger(),
            project: makeProject(),
            context: makeContext(),
            recipients: ["a@example.com", "unsubscribed@example.com"],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });

        expect(filterSuppressedRecipients).toHaveBeenCalledWith({
          projectId: "proj_1",
          triggerId: "trg_1",
          emails: ["a@example.com", "unsubscribed@example.com"],
        });
        const call = sendEmail.mock.calls[0]?.[0] as {
          triggerEmails: string[];
        };
        expect(call.triggerEmails).toEqual(["a@example.com"]);
      });
    });

    describe("when every recipient is suppressed", () => {
      it("does not send at all", async () => {
        const { deps, sendEmail, filterSuppressedRecipients } = makeDeps();
        filterSuppressedRecipients.mockResolvedValueOnce([]);

        const result = await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger(),
            project: makeProject(),
            context: makeContext(),
            recipients: ["unsubscribed@example.com"],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });

        expect(sendEmail).not.toHaveBeenCalled();
        expect(result.didSend).toBe(false);
      });
    });

    describe("when the trigger overrides emailSubjectTemplate", () => {
      it("renders the custom subject instead of the alert default", async () => {
        const { deps, sendEmail } = makeDeps();
        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              emailSubjectTemplate:
                "Custom: {{ trigger.name }} crossed {{ condition.threshold }}",
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: ["a@example.com"],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });
        const call = sendEmail.mock.calls[0]?.[0] as { subject: string };
        expect(call.subject).toBe("Custom: High latency crossed 500");
      });
    });

    describe("when the trigger overrides emailBodyTemplate", () => {
      it("renders the custom body Markdown into HTML", async () => {
        const { deps, sendEmail } = makeDeps();
        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              emailBodyTemplate:
                "## Heads up\n\nValue **{{ currentValue }}** vs threshold {{ condition.threshold }}",
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: ["a@example.com"],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });
        const call = sendEmail.mock.calls[0]?.[0] as { html: string };
        expect(call.html).toContain("<h2>Heads up</h2>");
        expect(call.html).toContain("712");
        expect(call.html).toContain("500");
      });
    });

    describe("when recipients is empty", () => {
      it("skips the send and reports didSend false", async () => {
        const { deps, sendEmail } = makeDeps();
        const result = await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger(),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });
        expect(result.didSend).toBe(false);
        expect(sendEmail).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a SEND_SLACK_MESSAGE trigger with a webhook", () => {
    it("renders against the alert defaults and calls sendSlack with payload", async () => {
      const { deps, sendSlack, sendEmail } = makeDeps();
      const result = await dispatchGraphAlertAction({
        deps,
        input: {
          trigger: makeTrigger({
            action: TriggerAction.SEND_SLACK_MESSAGE,
          }),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: "https://hooks.slack.com/services/T/B/abc",
          fireDigest: FIRE_DIGEST,
        },
      });

      expect(result.channel).toBe("slack");
      expect(result.didSend).toBe(true);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendSlack).toHaveBeenCalledTimes(1);
      const call = sendSlack.mock.calls[0]?.[0] as {
        triggerWebhook: string;
        triggerName: string;
        payload: { text?: string; blocks?: unknown };
      };
      expect(call.triggerWebhook).toBe(
        "https://hooks.slack.com/services/T/B/abc",
      );
      expect(call.triggerName).toBe("High latency");
      const text = (call.payload as { text: string }).text;
      expect(text).toContain("High latency");
      expect(text).toContain("712");
    });

    describe("when the trigger overrides slackTemplate as block_kit", () => {
      it("renders the custom Block Kit JSON", async () => {
        const { deps, sendSlack } = makeDeps();
        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              action: TriggerAction.SEND_SLACK_MESSAGE,
              slackTemplateType: "block_kit",
              slackTemplate: `[
  {"type": "section", "text": {"type": "mrkdwn", "text": {{ trigger.name | prepend: "*Alert:* " | json }}}}
]`,
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: "https://hooks.slack.com/services/T/B/xyz",
            fireDigest: FIRE_DIGEST,
          },
        });
        const call = sendSlack.mock.calls[0]?.[0] as {
          payload: { blocks: Array<Record<string, unknown>> };
        };
        expect(call.payload.blocks).toHaveLength(1);
        expect(JSON.stringify(call.payload.blocks)).toContain(
          "*Alert:* High latency",
        );
      });
    });

    describe("when slackWebhook is null", () => {
      it("skips the send and reports didSend false", async () => {
        const { deps, sendSlack } = makeDeps();
        const result = await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              action: TriggerAction.SEND_SLACK_MESSAGE,
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });
        expect(result.didSend).toBe(false);
        expect(sendSlack).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a SEND_SLACK_MESSAGE trigger with a bot connection", () => {
    it("posts through the Web API with the gated blocks open", async () => {
      const { deps, sendSlackBot, sendSlack } = makeDeps();
      const result = await dispatchGraphAlertAction({
        deps,
        input: {
          trigger: makeTrigger({ action: TriggerAction.SEND_SLACK_MESSAGE }),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: null,
          botDestination: { token: "xoxb-1", channel: "C123" },
          fireDigest: FIRE_DIGEST,
        },
      });

      expect(result.didSend).toBe(true);
      expect(sendSlack).not.toHaveBeenCalled();
      expect(sendSlackBot).toHaveBeenCalledTimes(1);
      const call = sendSlackBot.mock.calls[0]?.[0] as {
        token: string;
        channel: string;
      };
      expect(call.token).toBe("xoxb-1");
      expect(call.channel).toBe("C123");
    });
  });

  // Regression (dispatch5015-P1, Finding 4): the graph-alert incident row is
  // written AFTER the send. If that write throws, the outbox retries the whole
  // evaluation, `findOpenForGraphAlert` still returns null, and the dispatcher
  // runs again — so without a per-recipient ledger the same breach delivers up
  // to `maxAttempts` duplicate notifications. These execute the retry.
  describe("given a dispatch that is retried under the same fire digest", () => {
    describe("when the email recipients were already delivered by the first attempt", () => {
      it("passes the mailer a gate that reports them sent, so nobody is emailed twice", async () => {
        const { deps, sendEmail, claims } = makeDeps();
        const input = {
          trigger: makeTrigger(),
          project: makeProject(),
          context: makeContext(),
          recipients: ["a@example.com"],
          slackWebhook: null,
          fireDigest: FIRE_DIGEST,
        };

        // Attempt 1: the mailer hashes each address, checks the gate, sends,
        // and records. Drive that contract through the real callbacks.
        await dispatchGraphAlertAction({ deps, input });
        const first = sendEmail.mock.calls[0]?.[0] as {
          isRecipientSent: (hash: string) => Promise<boolean>;
          recordRecipientSent: (hash: string) => Promise<void>;
        };
        expect(await first.isRecipientSent("hash-of-a")).toBe(false);
        await first.recordRecipientSent("hash-of-a");

        // …then the incident write blows up and the outbox retries.
        await dispatchGraphAlertAction({ deps, input });
        const second = sendEmail.mock.calls[1]?.[0] as {
          isRecipientSent: (hash: string) => Promise<boolean>;
        };
        expect(await second.isRecipientSent("hash-of-a")).toBe(true);
        expect([...claims]).toEqual([`rcpt:${FIRE_DIGEST}:hash-of-a`]);
      });
    });

    describe("when the Slack webhook was already posted to by the first attempt", () => {
      it("skips the re-post entirely and still reports the fire as delivered", async () => {
        const { deps, sendSlack } = makeDeps();
        const input = {
          trigger: makeTrigger({ action: TriggerAction.SEND_SLACK_MESSAGE }),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: "https://hooks.slack.com/services/T/B/abc",
          fireDigest: FIRE_DIGEST,
        };

        const first = await dispatchGraphAlertAction({ deps, input });
        const retry = await dispatchGraphAlertAction({ deps, input });

        expect(first.didSend).toBe(true);
        expect(sendSlack).toHaveBeenCalledTimes(1);
        // `didSend` stays true on the retry: the alert DID reach Slack, on the
        // attempt that crashed before recording the incident. The caller must
        // open the incident now rather than treat the fire as undelivered.
        expect(retry.didSend).toBe(true);
      });
    });

    describe("when the Slack bot channel was already posted to by the first attempt", () => {
      it("skips the re-post entirely", async () => {
        const { deps, sendSlackBot } = makeDeps();
        const input = {
          trigger: makeTrigger({ action: TriggerAction.SEND_SLACK_MESSAGE }),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: null,
          botDestination: { token: "xoxb-1", channel: "C123" },
          fireDigest: FIRE_DIGEST,
        };

        await dispatchGraphAlertAction({ deps, input });
        const retry = await dispatchGraphAlertAction({ deps, input });

        expect(sendSlackBot).toHaveBeenCalledTimes(1);
        expect(retry.didSend).toBe(true);
      });
    });

    describe("when the NEXT fire of the same alert dispatches", () => {
      it("carries a different digest, so its recipients are not suppressed", async () => {
        const { deps, sendSlack } = makeDeps();
        const base = {
          trigger: makeTrigger({ action: TriggerAction.SEND_SLACK_MESSAGE }),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: "https://hooks.slack.com/services/T/B/abc",
        };

        await dispatchGraphAlertAction({
          deps,
          input: { ...base, fireDigest: FIRE_DIGEST },
        });
        await dispatchGraphAlertAction({
          deps,
          input: { ...base, fireDigest: "fedcba9876543210" },
        });

        expect(sendSlack).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a trigger with a non-notify action", () => {
    it("throws a non-retryable DispatchError so the row dead-letters (dispatch5015-002)", async () => {
      const { deps, sendEmail, sendSlack } = makeDeps();
      await expect(
        dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({ action: TriggerAction.ADD_TO_DATASET }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        }),
      ).rejects.toThrow(/not supported/);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendSlack).not.toHaveBeenCalled();
    });
  });
});

describe("graphAlertFireDigest", () => {
  describe("given the same fire generation", () => {
    it("returns the same digest, so a retry reuses the recipient claims", () => {
      const args = {
        triggerId: "trg_1",
        customGraphId: "graph_1",
        previousFireId: "sent_7",
      };
      expect(graphAlertFireDigest(args)).toBe(graphAlertFireDigest(args));
    });
  });

  describe("given the incident opened by the previous fire", () => {
    it("returns a different digest, so the next fire re-notifies everyone", () => {
      const before = graphAlertFireDigest({
        triggerId: "trg_1",
        customGraphId: "graph_1",
        previousFireId: null,
      });
      const after = graphAlertFireDigest({
        triggerId: "trg_1",
        customGraphId: "graph_1",
        previousFireId: "sent_1",
      });
      expect(after).not.toBe(before);
    });
  });
});
