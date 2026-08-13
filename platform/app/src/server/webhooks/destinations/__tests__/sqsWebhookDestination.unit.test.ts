import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The queue client and the rate limiter are the two boundaries; everything
// else in these tests is the real envelope, the real signature and the real
// classification.
vi.mock("~/server/rateLimit", () => ({ rateLimit: vi.fn() }));

import { rateLimit } from "~/server/rateLimit";
import { WEBHOOK_SIGNATURE_HEADER } from "../../signature";
import { inspectSqsQueueUrl, parseSqsQueueUrl } from "../sqsQueueUrl";
import {
  classifySqsFailure,
  SQS_MAX_MESSAGE_BYTES,
  sqsMessageAttributes,
  sqsMessageBytes,
  sqsWebhookDestination,
} from "../sqsWebhookDestination";
import type { WebhookDispatchRequest } from "../types";

const mockedRateLimit = vi.mocked(rateLimit);

const QUEUE_URL =
  "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-dev-billing-webhooks";

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

function request(
  overrides: Partial<WebhookDispatchRequest> = {},
): WebhookDispatchRequest {
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

/** A fake queue client that records what it was asked to send. */
function fakeQueue(behavior?: { rejectWith?: unknown }) {
  const sent: Array<Record<string, unknown>> = [];
  const client = {
    send: vi.fn(async (command: { input: Record<string, unknown> }) => {
      if (behavior?.rejectWith) throw behavior.rejectWith;
      sent.push(command.input);
      return { MessageId: "msg-abc-123" };
    }),
    destroy: vi.fn(),
  };
  return { sent, client };
}

describe("sqsWebhookDestination", () => {
  beforeEach(() => {
    mockedRateLimit.mockResolvedValue({
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
      const { sent, client } = fakeQueue();
      const destination = sqsWebhookDestination(
        {
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        { createClient: () => client as never },
      );

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
      const { sent, client } = fakeQueue();
      const destination = sqsWebhookDestination(
        {
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        { createClient: () => client as never },
      );

      await destination.send(request({ attempt: 3 }));

      const attributes = sent[0]!.MessageAttributes as Record<
        string,
        { StringValue: string }
      >;
      expect(Object.keys(attributes)).toContain(WEBHOOK_SIGNATURE_HEADER);
      expect(attributes[WEBHOOK_SIGNATURE_HEADER]!.StringValue).toMatch(
        /^t=\d+,v1=[0-9a-f]+/,
      );
      expect(attributes["X-LangWatch-Delivery-Id"]!.StringValue).toBe(
        "wh_1:abc123",
      );
      expect(attributes["X-LangWatch-Delivery-Attempt"]!.StringValue).toBe("3");
    });

    /** @scenario The transport answers with a verdict, not a status */
    it("answers success with a message id and no status", async () => {
      const { client } = fakeQueue();
      const destination = sqsWebhookDestination(
        {
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        { createClient: () => client as never },
      );

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
      const { client, sent } = fakeQueue();
      const destination = sqsWebhookDestination(
        {
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        { createClient: () => client as never },
      );

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
      const attributes = sqsMessageAttributes({
        batchId: "wh_1:abc",
        attempt: 1,
        signature: "t=1,v1=deadbeef",
      });
      const bodyOnly = sqsMessageBytes({ body: "{}", attributes: {} });
      const withAttributes = sqsMessageBytes({ body: "{}", attributes });
      expect(withAttributes).toBeGreaterThan(bodyOnly);
    });
  });

  describe("when the organization is at its hourly dispatch cap", () => {
    /** @scenario Both destinations answer to the same hourly dispatch cap */
    it("backs off rather than writing to the queue", async () => {
      mockedRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      } as never);
      const { client, sent } = fakeQueue();
      const destination = sqsWebhookDestination(
        {
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        { createClient: () => client as never },
      );

      await expect(destination.send(request())).rejects.toMatchObject({
        retryable: true,
      });
      expect(sent).toHaveLength(0);
      expect(mockedRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({ key: "webhook-dispatch:org_1" }),
      );
    });

    it("exempts a test fire, exactly as the HTTPS transport does", async () => {
      mockedRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      } as never);
      const { client, sent } = fakeQueue();
      const destination = sqsWebhookDestination(
        {
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        { createClient: () => client as never },
      );

      const result = await destination.send(request({ testFire: true }));

      expect(result.verdict).toBe("success");
      expect(sent).toHaveLength(1);
      expect(mockedRateLimit).not.toHaveBeenCalled();
      const attributes = sent[0]!.MessageAttributes as Record<
        string,
        { StringValue: string }
      >;
      expect(attributes["X-LangWatch-Test-Fire"]!.StringValue).toBe("true");
    });
  });

  describe("when the send fails", () => {
    /** @scenario A missing or forbidden queue is terminal, a throttled one retries */
    it("classifies a missing queue and a refused permission as terminal", () => {
      expect(
        classifySqsFailure({
          name: "AWS.SimpleQueueService.NonExistentQueue",
        }).verdict,
      ).toBe("terminal");
      expect(classifySqsFailure({ name: "QueueDoesNotExist" }).verdict).toBe(
        "terminal",
      );
      expect(classifySqsFailure({ name: "AccessDenied" }).verdict).toBe(
        "terminal",
      );
      expect(
        classifySqsFailure({ name: "AccessDeniedException" }).verdict,
      ).toBe("terminal");
    });

    /** @scenario A missing or forbidden queue is terminal, a throttled one retries */
    it("classifies throttling, server errors and network failures as retryable", () => {
      expect(classifySqsFailure({ name: "ThrottlingException" }).verdict).toBe(
        "retryable",
      );
      expect(
        classifySqsFailure({ $metadata: { httpStatusCode: 503 } }).verdict,
      ).toBe("retryable");
      expect(classifySqsFailure({ code: "ECONNRESET" }).verdict).toBe(
        "retryable",
      );
    });

    /** @scenario A missing or forbidden queue is terminal, a throttled one retries */
    it("keeps an expired credential retryable, so an expiring session is not a dead queue", () => {
      expect(classifySqsFailure({ name: "ExpiredToken" }).verdict).toBe(
        "retryable",
      );
      expect(
        classifySqsFailure({ name: "ExpiredTokenException" }).verdict,
      ).toBe("retryable");
    });

    it("treats a failure it has never seen as retryable, since the ladder gives up on its own", () => {
      expect(classifySqsFailure({ name: "SomethingNewFromAws" }).verdict).toBe(
        "retryable",
      );
    });

    it("returns the classified verdict rather than throwing", async () => {
      const { client } = fakeQueue({
        rejectWith: Object.assign(new Error("queue is gone"), {
          name: "QueueDoesNotExist",
        }),
      });
      const destination = sqsWebhookDestination(
        {
          queueUrl: QUEUE_URL,
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
        },
        { createClient: () => client as never },
      );

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
      inspectSqsQueueUrl(
        "https://sqs.eu-central-1.amazonaws.com/381491922238/orders.fifo",
      ),
    ).toEqual({ ok: false, problem: "fifo" });
  });

  it("accepts the China partition spelling", () => {
    const parsed = parseSqsQueueUrl(
      "https://sqs.cn-north-1.amazonaws.com.cn/381491922238/events",
    );
    expect(parsed?.region).toBe("cn-north-1");
  });
});
