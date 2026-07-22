import type { TriggerRow } from "@langwatch/automations/domain/trigger";
import { TriggerAction } from "@langwatch/automations/enums";
import { describe, expect, it, vi } from "vitest";
import { buildGraphAlertTemplateContext } from "@langwatch/automations/templating/templateContext";
import {
  dispatchGraphAlertAction,
  graphAlertFireDigest,
} from "../graph-alert-dispatch";

// Fake cipher, mirroring what the app's decryptWebhookHeaders does over the
// mocked crypto it used to reach through: strip the enc() wrapper, parse.
const fakeDecryptWebhookHeaders = (params: {
  headersEncrypted?: string;
  headers?: Record<string, string>;
}): Record<string, string> => {
  if (params.headersEncrypted) {
    return JSON.parse(
      params.headersEncrypted.replace(/^enc\(/, "").replace(/\)$/, ""),
    ) as Record<string, string>;
  }
  return params.headers ?? {};
};

const NOW = new Date("2026-06-21T10:00:00.000Z");

function makeTrigger(overrides: Partial<TriggerRow> = {}): TriggerRow {
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
  } as unknown as TriggerRow;
}

function makeProject(): { id: string } {
  return {
    id: "proj_1",
    name: "Acme",
    slug: "acme",
  } as unknown as { id: string };
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
  // Returns a 2xx by default — individual tests override to exercise the
  // retry/terminal classification the dispatcher applies via
  // assertWebhookDelivered.
  const sendWebhook = vi.fn(
    async (_payload: unknown) => ({ status: 200, body: "ok" }),
  );
  // Pass-through suppression by default — individual tests override to
  // exercise the ADR-031 unsubscribe gate.
  const filterSuppressedRecipients = vi.fn(
    async ({ emails }: { emails: string[] }) => emails,
  );
  // Under both ADR-031 caps by default — individual tests override to
  // exercise the exhausted branches.
  const consumeEmailCapSlot = vi.fn(
    async (_params: { dedupKey: string }) => ({ allowed: true, count: 1 }),
  );
  const consumeTenantEmailCapSlot = vi.fn(
    async (_params: { dedupKey: string; recipientCount: number }) => ({
      allowed: true,
      count: 1,
    }),
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
      sendWebhook,
      filterSuppressedRecipients,
      consumeEmailCapSlot,
      emailHourlyCap: 100,
      consumeTenantEmailCapSlot,
      tenantDailyCap: 10_000,
      isRecipientSent,
      recordRecipientSent,
      decryptWebhookHeaders: fakeDecryptWebhookHeaders,
    } as unknown as Parameters<typeof dispatchGraphAlertAction>[0]["deps"],
    sendEmail,
    sendSlack,
    sendSlackBot,
    sendWebhook,
    filterSuppressedRecipients,
    consumeEmailCapSlot,
    consumeTenantEmailCapSlot,
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

  // Regression (dispatch5015 P1): the event-sourced graph-alert path called
  // the dispatcher WITHOUT consuming the ADR-031 email caps, while the cron
  // consumed both before the same send — so with the firing flag on, a
  // flapping graph metric could mail unbounded past TRIGGER_EMAIL_HOURLY_CAP /
  // TRIGGER_EMAIL_TENANT_DAILY_CAP. Both gates now live inside the dispatcher,
  // shared by both callers.
  describe("given the ADR-031 email caps", () => {
    function makeEmailInput() {
      return {
        trigger: makeTrigger(),
        project: makeProject(),
        context: makeContext(),
        recipients: ["a@example.com", "b@example.com"],
        slackWebhook: null,
        fireDigest: FIRE_DIGEST,
      };
    }

    describe("when both caps have slots left", () => {
      it("consumes the hourly cap before the provider call, keyed on the fire digest", async () => {
        const { deps, sendEmail, consumeEmailCapSlot } = makeDeps();

        await dispatchGraphAlertAction({ deps, input: makeEmailInput() });

        expect(consumeEmailCapSlot).toHaveBeenCalledTimes(1);
        expect(consumeEmailCapSlot).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj_1",
            triggerId: "trg_1",
            dedupKey: `proj_1/trg_1:digest:${FIRE_DIGEST}`,
          }),
        );
        const capOrder = consumeEmailCapSlot.mock.invocationCallOrder[0]!;
        const sendOrder = sendEmail.mock.invocationCallOrder[0]!;
        expect(capOrder).toBeLessThan(sendOrder);
      });

      it("consumes the project daily cap by surviving recipient count", async () => {
        const {
          deps,
          filterSuppressedRecipients,
          consumeTenantEmailCapSlot,
        } = makeDeps();
        filterSuppressedRecipients.mockResolvedValueOnce(["a@example.com"]);

        await dispatchGraphAlertAction({ deps, input: makeEmailInput() });

        // Counts RECIPIENTS after suppression (1 of 2 survived), not
        // dispatches — the daily cap bounds actual outbound email volume.
        expect(consumeTenantEmailCapSlot).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj_1",
            recipientCount: 1,
            dedupKey: `proj_1:tenant:${FIRE_DIGEST}`,
          }),
        );
      });
    });

    describe("when the trigger is over its hourly cap", () => {
      it("skips the send, never consults the daily cap, and reports the fire as consumed", async () => {
        const { deps, sendEmail, consumeEmailCapSlot, consumeTenantEmailCapSlot } =
          makeDeps();
        consumeEmailCapSlot.mockResolvedValueOnce({
          allowed: false,
          count: 101,
        });

        const result = await dispatchGraphAlertAction({
          deps,
          input: makeEmailInput(),
        });

        expect(sendEmail).not.toHaveBeenCalled();
        expect(consumeTenantEmailCapSlot).not.toHaveBeenCalled();
        // `didSend` stays true so the evaluator keeps its open claim — the
        // incident must open exactly as the cron's `addTriggersSent` does
        // after a cap-suppressed send; rolling the claim back would re-arm
        // the alert on every fold update while the cap is exhausted.
        expect(result.didSend).toBe(true);
        expect(result.capExhausted).toBe("trigger-hourly");
      });
    });

    describe("when the project is over its daily email cap", () => {
      it("skips the send and reports the fire as consumed", async () => {
        const { deps, sendEmail, consumeTenantEmailCapSlot } = makeDeps();
        consumeTenantEmailCapSlot.mockResolvedValueOnce({
          allowed: false,
          count: 10_001,
        });

        const result = await dispatchGraphAlertAction({
          deps,
          input: makeEmailInput(),
        });

        expect(sendEmail).not.toHaveBeenCalled();
        expect(result.didSend).toBe(true);
        expect(result.capExhausted).toBe("project-daily");
      });
    });

    describe("when the same fire is retried by the outbox", () => {
      it("passes identical dedup keys, so the consumer's claim gate prevents a double-consume", async () => {
        const { deps, consumeEmailCapSlot, consumeTenantEmailCapSlot } =
          makeDeps();
        const input = makeEmailInput();

        await dispatchGraphAlertAction({ deps, input });
        await dispatchGraphAlertAction({ deps, input });

        // The no-double-consume guarantee lives in the consumer's SET-NX
        // claim on the dedupKey — the dispatcher's contract is a STABLE key
        // per fire, identical across retries.
        const hourlyKeys = consumeEmailCapSlot.mock.calls.map(
          (call) => (call[0] as { dedupKey: string }).dedupKey,
        );
        expect(hourlyKeys).toEqual([
          `proj_1/trg_1:digest:${FIRE_DIGEST}`,
          `proj_1/trg_1:digest:${FIRE_DIGEST}`,
        ]);
        const tenantKeys = consumeTenantEmailCapSlot.mock.calls.map(
          (call) => (call[0] as { dedupKey: string }).dedupKey,
        );
        expect(tenantKeys).toEqual([
          `proj_1:tenant:${FIRE_DIGEST}`,
          `proj_1:tenant:${FIRE_DIGEST}`,
        ]);
      });
    });

    describe("when the NEXT fire of the same alert dispatches", () => {
      it("carries a different dedup key, so it consumes a fresh cap slot", async () => {
        const { deps, consumeEmailCapSlot } = makeDeps();

        await dispatchGraphAlertAction({ deps, input: makeEmailInput() });
        await dispatchGraphAlertAction({
          deps,
          input: { ...makeEmailInput(), fireDigest: "fedcba9876543210" },
        });

        const keys = consumeEmailCapSlot.mock.calls.map(
          (call) => (call[0] as { dedupKey: string }).dedupKey,
        );
        expect(new Set(keys).size).toBe(2);
      });
    });

    describe("when every recipient is suppressed", () => {
      it("does not consume either cap", async () => {
        const {
          deps,
          filterSuppressedRecipients,
          consumeEmailCapSlot,
          consumeTenantEmailCapSlot,
        } = makeDeps();
        filterSuppressedRecipients.mockResolvedValueOnce([]);

        await dispatchGraphAlertAction({ deps, input: makeEmailInput() });

        expect(consumeEmailCapSlot).not.toHaveBeenCalled();
        expect(consumeTenantEmailCapSlot).not.toHaveBeenCalled();
      });
    });

    describe("when a Slack alert dispatches", () => {
      it("never consults the email caps", async () => {
        const { deps, consumeEmailCapSlot, consumeTenantEmailCapSlot } =
          makeDeps();

        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({ action: TriggerAction.SEND_SLACK_MESSAGE }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: "https://hooks.slack.com/services/T/B/abc",
            fireDigest: FIRE_DIGEST,
          },
        });

        expect(consumeEmailCapSlot).not.toHaveBeenCalled();
        expect(consumeTenantEmailCapSlot).not.toHaveBeenCalled();
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

  describe("given a SEND_WEBHOOK trigger with a URL", () => {
    const webhookTrigger = () =>
      makeTrigger({
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: { url: "https://example.com/hook", method: "POST" },
      });

    it("renders the alert body and sends it to the configured URL", async () => {
      const { deps, sendWebhook, sendEmail, sendSlack } = makeDeps();
      const result = await dispatchGraphAlertAction({
        deps,
        input: {
          trigger: webhookTrigger(),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: null,
          fireDigest: FIRE_DIGEST,
        },
      });

      expect(result.channel).toBe("webhook");
      expect(result.didSend).toBe(true);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendSlack).not.toHaveBeenCalled();
      expect(sendWebhook).toHaveBeenCalledTimes(1);
      const call = sendWebhook.mock.calls[0]?.[0] as {
        url: string;
        body: string;
      };
      expect(call.url).toBe("https://example.com/hook");
      const body = JSON.parse(call.body) as { event: string };
      expect(body.event).toBe("alert.fired");
    });

    describe("when header secrets are stored encrypted", () => {
      it("decrypts them just before the send", async () => {
        const { deps, sendWebhook } = makeDeps();
        await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              action: TriggerAction.SEND_WEBHOOK,
              actionParams: {
                url: "https://example.com/hook",
                method: "POST",
                headersEncrypted: `enc(${JSON.stringify({
                  Authorization: "Bearer secret",
                })})`,
              },
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });
        const call = sendWebhook.mock.calls[0]?.[0] as {
          headers: Record<string, string>;
        };
        expect(call.headers).toEqual({ Authorization: "Bearer secret" });
      });
    });

    describe("when the URL is not configured", () => {
      it("skips the send and reports didSend false", async () => {
        const { deps, sendWebhook } = makeDeps();
        const result = await dispatchGraphAlertAction({
          deps,
          input: {
            trigger: makeTrigger({
              action: TriggerAction.SEND_WEBHOOK,
              actionParams: {},
            }),
            project: makeProject(),
            context: makeContext(),
            recipients: [],
            slackWebhook: null,
            fireDigest: FIRE_DIGEST,
          },
        });
        expect(result.didSend).toBe(false);
        expect(sendWebhook).not.toHaveBeenCalled();
      });
    });

    describe("when the endpoint answers a retryable status", () => {
      it("throws a retryable DispatchError and does NOT claim the fire", async () => {
        const { deps, sendWebhook, claims } = makeDeps();
        sendWebhook.mockResolvedValueOnce({ status: 503, body: "down" });
        const input = {
          trigger: webhookTrigger(),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: null,
          fireDigest: FIRE_DIGEST,
        };
        await expect(
          dispatchGraphAlertAction({ deps, input }),
        ).rejects.toMatchObject({ retryable: true });
        // No claim recorded — a retry must re-attempt, not skip as delivered.
        expect(claims.size).toBe(0);
      });
    });

    describe("when the same fire is retried after a successful post", () => {
      it("does not re-post to an endpoint already reached", async () => {
        const { deps, sendWebhook } = makeDeps();
        const input = {
          trigger: webhookTrigger(),
          project: makeProject(),
          context: makeContext(),
          recipients: [],
          slackWebhook: null,
          fireDigest: FIRE_DIGEST,
        };
        await dispatchGraphAlertAction({ deps, input });
        await dispatchGraphAlertAction({ deps, input });
        expect(sendWebhook).toHaveBeenCalledTimes(1);
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
