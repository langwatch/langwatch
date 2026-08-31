/**
 * Sending one graph alert, once.
 *
 * The behaviour worth guarding is what happens on a retry. A fire is claimed
 * PER RECIPIENT, so a delivery that emailed two of three addresses and then
 * failed does not email those two again when the intent is retried — and the
 * third still gets theirs. Both halves matter: a claim that is too coarse
 * loses recipients, one that is too fine sends duplicates.
 *
 * The other is the cap. When an alert is dropped for exceeding its hourly or
 * daily allowance the result says `didSend: true` — not because anything was
 * sent, but because the send is SETTLED and must not be retried. Returning
 * false there would put the alert back on the queue to be dropped again,
 * forever.
 */

import { describe, expect, it } from "vitest";
import { buildGraphAlertTemplateContext } from "@langwatch/automation-contract";
import { GraphAlertDispatchService } from "../graph-alert-dispatch.service";

/** A real alert context, built the way the evaluator builds one. */
const CONTEXT = buildGraphAlertTemplateContext({
  trigger: { id: "trigger-1", name: "High latency", alertType: "WARNING" },
  graph: { id: "graph-1", name: "Latency p95" },
  metric: { label: "Latency p95", seriesName: "0/duration/p95" },
  condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
  currentValue: 712,
  occurredAt: new Date("2026-06-21T10:00:00.000Z"),
  reason: "real-time",
  project: { id: "project-1", name: "Acme", slug: "acme" },
  baseHost: "https://app.langwatch.ai",
});

type Recorded = { claimed: string[]; emailed: string[][] };

function dispatcherWith(
  options: {
    suppressed?: string[];
    alreadyClaimed?: string[];
    hourlyAllowed?: boolean;
    dailyAllowed?: boolean;
  } = {},
) {
  const recorded: Recorded = { claimed: [], emailed: [] };
  const capCalls: Array<Record<string, unknown>> = [];

  const service = GraphAlertDispatchService.create({
    persistence: {
      filterSuppressed: async ({ emails }: { emails: string[] }) =>
        emails.filter((email) => !(options.suppressed ?? []).includes(email)),
      isSendClaimed: async ({ traceId }: { traceId: string }) =>
        (options.alreadyClaimed ?? []).includes(traceId),
      claimSend: async ({ traceId }: { traceId: string }) => {
        recorded.claimed.push(traceId);
      },
    },
    emailCaps: {
      consumeHourly: async (input: Record<string, unknown>) => {
        capCalls.push({ ...input, which: "hourly" });
        return { allowed: options.hourlyAllowed ?? true };
      },
      consumeDaily: async (input: Record<string, unknown>) => {
        capCalls.push({ ...input, which: "daily" });
        return { allowed: options.dailyAllowed ?? true };
      },
    },
    delivery: {
      sendEmail: async ({
        recipients,
        isRecipientSent,
        recordRecipientSent,
      }: {
        recipients: string[];
        isRecipientSent: (recipient: string) => Promise<boolean>;
        recordRecipientSent: (recipient: string) => Promise<void>;
      }) => {
        const sent: string[] = [];
        for (const recipient of recipients) {
          if (await isRecipientSent(recipient)) continue;
          sent.push(recipient);
          await recordRecipientSent(recipient);
        }
        recorded.emailed.push(sent);
      },
    },
    webhooks: {},
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    emailHourlyCap: 10,
    tenantDailyCap: 100,
  } as never);

  return { capCalls, recorded, service };
}

const input = (over: Record<string, unknown> = {}) =>
  ({
    trigger: {
      id: "trigger-1",
      action: "SEND_EMAIL",
      templates: { emailSubjectTemplate: null, emailBodyTemplate: null },
    },
    project: { id: "project-1" },
    context: CONTEXT,
    recipients: ["a@example.com", "b@example.com"],
    slackWebhook: null,
    fireDigest: "digest-1",
    ...over,
  }) as never;

describe("GraphAlertDispatchService.dispatch", () => {
  describe("given an action nothing knows how to send", () => {
    it("refuses without retrying, since another attempt cannot help", async () => {
      const { service } = dispatcherWith();

      await expect(
        service.dispatch(input({ trigger: { id: "t", action: "SEND_PIGEON", templates: {} } })),
      ).rejects.toMatchObject({ retryable: false });
    });
  });

  describe("given no recipients", () => {
    it("sends nothing and says so", async () => {
      const { service, recorded } = dispatcherWith();

      await expect(service.dispatch(input({ recipients: [] }))).resolves.toMatchObject({
        channel: "email",
        didSend: false,
      });
      expect(recorded.emailed).toHaveLength(0);
    });
  });

  describe("given every recipient has unsubscribed", () => {
    it("sends nothing rather than an email to nobody", async () => {
      const { service, recorded } = dispatcherWith({
        suppressed: ["a@example.com", "b@example.com"],
      });

      await expect(service.dispatch(input())).resolves.toMatchObject({ didSend: false });
      expect(recorded.emailed).toHaveLength(0);
    });
  });

  describe("given one recipient has unsubscribed", () => {
    it("still sends to the others", async () => {
      const { service, recorded } = dispatcherWith({ suppressed: ["a@example.com"] });

      await service.dispatch(input());

      expect(recorded.emailed).toEqual([["b@example.com"]]);
    });
  });

  describe("given the fire is retried after a partial delivery", () => {
    it("skips the recipient already reached and sends the one that was not", async () => {
      // The claim is per recipient, so a retry is not all-or-nothing.
      const first = dispatcherWith();
      await first.service.dispatch(input());
      const claimedForA = first.recorded.claimed[0]!;

      const retry = dispatcherWith({ alreadyClaimed: [claimedForA] });
      await retry.service.dispatch(input());

      expect(retry.recorded.emailed).toEqual([["b@example.com"]]);
    });

    it("claims each recipient under a different key", async () => {
      const { service, recorded } = dispatcherWith();

      await service.dispatch(input());

      expect(new Set(recorded.claimed).size).toBe(2);
    });

    it("claims the same recipient under the same key on a re-fire of the same digest", async () => {
      const first = dispatcherWith();
      const second = dispatcherWith();

      await first.service.dispatch(input());
      await second.service.dispatch(input());

      expect(second.recorded.claimed).toEqual(first.recorded.claimed);
    });

    it("claims a different key for a different fire", async () => {
      const first = dispatcherWith();
      const other = dispatcherWith();

      await first.service.dispatch(input());
      await other.service.dispatch(input({ fireDigest: "digest-2" }));

      expect(other.recorded.claimed).not.toEqual(first.recorded.claimed);
    });
  });

  describe("given the hourly allowance is spent", () => {
    it("drops the alert and reports it settled, so it is not retried forever", async () => {
      const { service, recorded } = dispatcherWith({ hourlyAllowed: false });

      await expect(service.dispatch(input())).resolves.toMatchObject({
        channel: "email",
        didSend: true,
      });
      expect(recorded.emailed).toHaveLength(0);
    });
  });

  describe("given the tenant's daily allowance is spent", () => {
    it("drops it the same way", async () => {
      const { service, recorded } = dispatcherWith({ dailyAllowed: false });

      await expect(service.dispatch(input())).resolves.toMatchObject({ didSend: true });
      expect(recorded.emailed).toHaveLength(0);
    });
  });

  describe("the two allowances", () => {
    it("count the hourly one per trigger and the daily one per tenant", async () => {
      // A project's own daily budget is shared across its triggers; the hourly
      // one is the individual alert's. Their dedup keys say which is which.
      const { service, capCalls } = dispatcherWith();

      await service.dispatch(input());

      const hourly = capCalls.find((call) => call.which === "hourly");
      const daily = capCalls.find((call) => call.which === "daily");
      expect(hourly?.dedupKey).toContain("trigger-1");
      expect(daily?.dedupKey).not.toContain("trigger-1");
    });

    it("charges the daily allowance for every recipient, not once per alert", async () => {
      const { service, capCalls } = dispatcherWith();

      await service.dispatch(input());

      expect(capCalls.find((call) => call.which === "daily")?.recipientCount).toBe(2);
    });
  });
});
