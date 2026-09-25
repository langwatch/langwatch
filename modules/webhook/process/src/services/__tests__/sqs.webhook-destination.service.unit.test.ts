import { WEBHOOK_SIGNATURE_HEADER, type WebhookDispatchRateLimiter } from "@langwatch/egress";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookDispatchRequest } from "../../app/webhook.app.ts";
import type {
  SqsDestinationConfig,
  SqsWebhookSender,
} from "../../channels/webhook-destination.channel.ts";
import { inspectSqsQueueUrl, parseSqsQueueUrl } from "../../rules/sqs-queue-url.rules.ts";
import {
  SQS_MAX_MESSAGE_BYTES,
  SqsWebhookDestinationService,
} from "../sqs.webhook-destination.service.ts";

// The queue channel and the rate limiter are the two boundaries; everything
// else in these tests is the real envelope, the real signature and the real
// classification.
const limitMock = vi.fn<WebhookDispatchRateLimiter["limit"]>();
const rateLimiter: WebhookDispatchRateLimiter = { limit: limitMock };

const QUEUE_URL = "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-dev-billing-webhooks";

const BATCH_BODY = JSON.stringify({
  batch: [
    {
      id: "evt_1",
      type: "gateway.request.completed",
      created: "2026-08-13T00:00:00.000Z",
      schema_version: "1",
      data: { gateway_request_id: "req_1" },
    },
  ],
});

function request(overrides: Partial<WebhookDispatchRequest> = {}): WebhookDispatchRequest {
  return {
    organizationId: "org_1",
    endpointId: "wh_1",
    body: BATCH_BODY,
    batchId: "wh_1:abc123",
    attempt: 1,
    signingSecrets: ["whsec_test"],
    ...overrides,
  };
}

/** A fake queue channel that records what it was asked to send. */
function fakeQueue(behavior?: { rejectWith?: unknown }) {
  const sent: Record<string, unknown>[] = [];
  const channel: SqsWebhookSender = {
    send: vi.fn(
      async (message: { config: SqsDestinationConfig; body: string; attributes: unknown }) => {
        if (behavior?.rejectWith) throw behavior.rejectWith;
        sent.push({
          QueueUrl: message.config.queueUrl,
          MessageBody: message.body,
          MessageAttributes: message.attributes,
        });
        return "msg-abc-123";
      },
    ),
    invalidate: vi.fn(),
  };
  return { sent, channel };
}

describe("SqsWebhookDestinationService", () => {
  beforeEach(() => {
    limitMock.mockResolvedValue({
      allowed: true,
      remaining: 999,
      resetAt: Date.now() + 3_600_000,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given a batch of envelopes", () => {
    /** @scenario A queue message carries the same bytes as the HTTP body */
    it("puts the exact HTTP body on the queue with no wrapper around it", async () => {
      const { sent, channel } = fakeQueue();
      const destination = SqsWebhookDestinationService.create({
        config: {
          channel,
          rateLimiter,
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
      });

      await destination.send(request());

      expect(sent).toHaveLength(1);
      expect(sent[0]!.MessageBody).toBe(BATCH_BODY);
      // Byte-for-byte, which is what makes one signature verifier read either
      // transport. A wrapper would be a second chance to break that.
      expect(JSON.parse(sent[0]!.MessageBody as string)).toEqual({
        batch: [expect.objectContaining({ id: "evt_1" })],
      });
      expect(sent[0]!.QueueUrl).toBe(QUEUE_URL);
    });

    /** @scenario Signature, delivery id and attempt ride as message attributes */
    it("carries the signature, delivery id and attempt under their header names", async () => {
      const { sent, channel } = fakeQueue();
      const destination = SqsWebhookDestinationService.create({
        config: {
          channel,
          rateLimiter,
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
      });

      await destination.send(request({ attempt: 3 }));

      const attributes = sent[0]!.MessageAttributes as Record<string, { StringValue: string }>;
      expect(Object.keys(attributes)).toContain(WEBHOOK_SIGNATURE_HEADER);
      expect(attributes[WEBHOOK_SIGNATURE_HEADER]!.StringValue).toMatch(/^t=\d+,v1=[0-9a-f]+/);
      expect(attributes["X-LangWatch-Delivery-Id"]!.StringValue).toBe("wh_1:abc123");
      expect(attributes["X-LangWatch-Delivery-Attempt"]!.StringValue).toBe("3");
      // A consumer that routes test fires away from its ingest path reads this
      // attribute, so its absence on an ordinary delivery is the contract too.
      expect(Object.keys(attributes)).not.toContain("X-LangWatch-Test-Fire");
    });

    /** @scenario Signature, delivery id and attempt ride as message attributes */
    it("marks a test fire under its own header name", async () => {
      const { sent, channel } = fakeQueue();
      const destination = SqsWebhookDestinationService.create({
        config: {
          channel,
          rateLimiter,
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
      });

      await destination.send(request({ isTestFire: true }));

      const attributes = sent[0]!.MessageAttributes as Record<string, { StringValue: string }>;
      expect(attributes["X-LangWatch-Test-Fire"]!.StringValue).toBe("true");
    });

    /** @scenario A queue delivery is recorded with no response status */
    it("answers success with a message id and no status", async () => {
      const { channel } = fakeQueue();
      const destination = SqsWebhookDestinationService.create({
        config: {
          channel,
          rateLimiter,
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
      });

      const result = await destination.send(request());

      expect(result.verdict).toBe("success");
      // A queue has no status, and inventing a 200 would make the delivery
      // log lie about what answered.
      expect(result.status).toBeNull();
      expect(result.body).toBe("msg-abc-123");
      expect(result.dispatchId).toBe("wh_1:abc123");
    });
  });

  describe("when the batch is larger than one message can carry", () => {
    /** @scenario A batch too large for one queue message is refused terminally */
    it("refuses terminally and names the batch-size control", async () => {
      const { channel, sent } = fakeQueue();
      const destination = SqsWebhookDestinationService.create({
        config: {
          channel,
          rateLimiter,
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
      });

      const result = await destination.send(
        request({ body: "x".repeat(SQS_MAX_MESSAGE_BYTES + 1) }),
      );

      expect(result.verdict).toBe("terminal");
      expect(result.error).toContain("maximum batch size");
      // Nothing was sent: the refusal is measured before the call, because
      // the API would reject it and the same bytes will never fit.
      expect(sent).toHaveLength(0);
    });

    it("counts attribute names, types and values against the limit", () => {
      const attributes = SqsWebhookDestinationService.messageAttributes({
        batchId: "wh_1:abc",
        attempt: 1,
        signature: "t=1,v1=deadbeef",
      });
      const bodyOnly = SqsWebhookDestinationService.messageBytes({ body: "{}", attributes: {} });
      const withAttributes = SqsWebhookDestinationService.messageBytes({ body: "{}", attributes });
      expect(withAttributes).toBeGreaterThan(bodyOnly);
    });
  });

  describe("when the organization is at its hourly dispatch cap", () => {
    function cappedDestination() {
      limitMock.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      } as never);
      const { channel, sent } = fakeQueue();
      const destination = SqsWebhookDestinationService.create({
        config: {
          channel,
          rateLimiter,
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
      });

      return { destination, sent };
    }

    /** @scenario Both destinations answer to the same hourly dispatch cap */
    it("backs off rather than writing to the queue", async () => {
      const { destination, sent } = cappedDestination();

      await expect(destination.send(request())).rejects.toMatchObject({
        retryable: true,
      });
      expect(sent).toHaveLength(0);
      expect(limitMock).toHaveBeenCalledWith(
        expect.objectContaining({ key: "webhook-dispatch:org_1" }),
      );
    });

    it("exempts a test fire, exactly as the HTTPS transport does", async () => {
      const { destination, sent } = cappedDestination();

      const result = await destination.send(request({ isTestFire: true }));

      expect(result.verdict).toBe("success");
      expect(sent).toHaveLength(1);
      expect(limitMock).not.toHaveBeenCalled();
      const attributes = sent[0]!.MessageAttributes as Record<string, { StringValue: string }>;
      expect(attributes["X-LangWatch-Test-Fire"]!.StringValue).toBe("true");
    });
  });

  describe("when the send fails", () => {
    /** @scenario A missing or forbidden queue is terminal, a throttled one retries */
    it("classifies a missing queue and a refused permission as terminal", () => {
      expect(
        SqsWebhookDestinationService.classifyFailure({
          name: "AWS.SimpleQueueService.NonExistentQueue",
        }).verdict,
      ).toBe("terminal");
      expect(
        SqsWebhookDestinationService.classifyFailure({ name: "QueueDoesNotExist" }).verdict,
      ).toBe("terminal");
      expect(SqsWebhookDestinationService.classifyFailure({ name: "AccessDenied" }).verdict).toBe(
        "terminal",
      );
      expect(
        SqsWebhookDestinationService.classifyFailure({ name: "AccessDeniedException" }).verdict,
      ).toBe("terminal");
    });

    /** @scenario A missing or forbidden queue is terminal, a throttled one retries */
    it("classifies throttling, server errors and network failures as retryable", () => {
      expect(
        SqsWebhookDestinationService.classifyFailure({ name: "ThrottlingException" }).verdict,
      ).toBe("retryable");
      expect(
        SqsWebhookDestinationService.classifyFailure({ $metadata: { httpStatusCode: 503 } })
          .verdict,
      ).toBe("retryable");
      expect(SqsWebhookDestinationService.classifyFailure({ code: "ECONNRESET" }).verdict).toBe(
        "retryable",
      );
    });

    /** @scenario A missing or forbidden queue is terminal, a throttled one retries */
    it("keeps an expired credential retryable, so an expiring session is not a dead queue", () => {
      expect(SqsWebhookDestinationService.classifyFailure({ name: "ExpiredToken" }).verdict).toBe(
        "retryable",
      );
      expect(
        SqsWebhookDestinationService.classifyFailure({ name: "ExpiredTokenException" }).verdict,
      ).toBe("retryable");
    });

    it("treats a failure it has never seen as retryable, since the ladder gives up on its own", () => {
      expect(
        SqsWebhookDestinationService.classifyFailure({ name: "SomethingNewFromAws" }).verdict,
      ).toBe("retryable");
    });

    it("returns the classified verdict rather than throwing", async () => {
      const { channel } = fakeQueue({
        rejectWith: Object.assign(new Error("queue is gone"), {
          name: "QueueDoesNotExist",
        }),
      });
      const destination = SqsWebhookDestinationService.create({
        config: {
          channel,
          rateLimiter,
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
      });

      const result = await destination.send(request());

      expect(result.verdict).toBe("terminal");
      expect(result.status).toBeNull();
      expect(result.error).toContain("QueueDoesNotExist");
    });
  });
});

describe("queue URL admission", () => {
  /** @scenario The region and the account come from the queue URL */
  it("reads the region, the account and the queue name off the URL", () => {
    const parsed = parseSqsQueueUrl(QUEUE_URL);
    expect(parsed).toEqual({
      queueUrl: QUEUE_URL,
      region: "eu-central-1",
      accountId: "381491922238",
      queueName: "lw-dev-billing-webhooks",
    });
  });

  it("refuses a URL that is not an Amazon SQS queue URL", () => {
    for (const url of [
      "https://example.com/queue",
      "http://sqs.eu-central-1.amazonaws.com/381491922238/q",
      "https://sqs.eu-central-1.amazonaws.com/12345/q",
      "https://sqs.eu-central-1.evil.com/381491922238/q",
      "https://sqs.eu-central-1.amazonaws.com.evil.com/381491922238/q",
    ]) {
      expect(inspectSqsQueueUrl(url)).toEqual({ ok: false, problem: "shape" });
    }
  });

  it("tells a FIFO queue apart from an unrecognizable URL", () => {
    expect(
      inspectSqsQueueUrl("https://sqs.eu-central-1.amazonaws.com/381491922238/orders.fifo"),
    ).toEqual({ ok: false, problem: "fifo" });
  });

  it("accepts the China partition spelling", () => {
    const parsed = parseSqsQueueUrl("https://sqs.cn-north-1.amazonaws.com.cn/381491922238/events");
    expect(parsed?.region).toBe("cn-north-1");
  });

  it("accepts the FIPS endpoints a regulated customer is required to use", () => {
    const parsed = parseSqsQueueUrl("https://sqs-fips.us-east-1.amazonaws.com/381491922238/events");
    expect(parsed).toMatchObject({ region: "us-east-1", queueName: "events" });
  });

  it("accepts the legacy regional spelling older consoles hand out", () => {
    const parsed = parseSqsQueueUrl("https://eu-central-1.queue.amazonaws.com/381491922238/events");
    expect(parsed).toMatchObject({
      region: "eu-central-1",
      accountId: "381491922238",
    });
  });

  // The region is read off the URL so it cannot disagree with the queue, and
  // this spelling has no region in it. Accepting it would mean guessing
  // us-east-1 and writing to whatever queue of that name lives there.
  it("refuses the region-less legacy spelling", () => {
    expect(inspectSqsQueueUrl("https://queue.amazonaws.com/381491922238/events")).toEqual({
      ok: false,
      problem: "shape",
    });
  });
});
