import { DispatchError } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import type { WebhookSendRequest } from "@langwatch/webhook-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HttpWebhookSender } from "../../channels/webhook-destination.channel.ts";
import type {
  WebhookDispatchCapCount,
  WebhookDispatchCapRepository,
} from "../../repositories/webhook-dispatch-cap.repository.ts";
import type {
  WebhookRequestAttempt,
  WebhookRequestAttemptRow,
} from "../../repositories/webhook-endpoint.repository.ts";
import { WebhookDispatchCapService } from "../webhook-dispatch-cap.service.ts";
import { WebhookEgressService } from "../webhook-egress.service.ts";
import { WebhookRequestService } from "../webhook-request.service.ts";

/**
 * Spec: modules/webhook/specs/webhook-egress.feature
 * The real sender, fence and classification; only the socket and the counter are stubbed.
 */

const mockedSend = vi.fn<HttpWebhookSender["send"]>();

class CountingCaps implements WebhookDispatchCapRepository {
  readonly scopes: string[] = [];

  constructor(private readonly allowed: boolean) {}

  async countAttempt(input: { scopeId: string }): Promise<WebhookDispatchCapCount> {
    this.scopes.push(input.scopeId);
    return { allowed: this.allowed, remaining: 0, resetAt: Date.now() + 60_000 };
  }
}

class RecordingLog {
  readonly attempts: WebhookRequestAttempt[] = [];
  rows: WebhookRequestAttemptRow[] = [];

  async recordRequestAttempt(attempt: WebhookRequestAttempt): Promise<void> {
    this.attempts.push(attempt);
  }

  async findRequestAttempts(): Promise<WebhookRequestAttemptRow[]> {
    return this.rows;
  }
}

function requestsWith({ allowed = true }: { allowed?: boolean } = {}) {
  const limiter = new CountingCaps(allowed);
  const log = new RecordingLog();
  const egress = WebhookEgressService.create({
    caps: WebhookDispatchCapService.create({ caps: limiter }),
    http: { send: mockedSend },
  });
  return { limiter, log, requests: WebhookRequestService.create({ egress, deliveries: log }) };
}

const request = (url = "https://hooks.acme.test/in"): WebhookSendRequest => ({
  projectId: "project-1",
  url,
  body: '{"ok":true}',
  dispatchId: "evt_stable",
  label: 'Webhook for trigger "Settles"',
  source: { module: "automation", ref: "trigger-1" },
});

afterEach(() => vi.clearAllMocks());

describe("WebhookRequestService", () => {
  describe("given a receiver that answers 2xx", () => {
    /** @scenario "A webhook request is sent once and filed in the webhook delivery log" */
    it("sends one attempt, answers its status and files a success row", async () => {
      mockedSend.mockResolvedValue({ status: 204, body: "", responseHeaders: {} });
      const { limiter, log, requests } = requestsWith();

      const result = await requests.send(request());

      expect(result).toEqual({ status: 204, dispatchId: "evt_stable" });
      expect(mockedSend).toHaveBeenCalledTimes(1);
      expect(limiter.scopes).toEqual(["project-1"]);
      expect(log.attempts).toEqual([
        expect.objectContaining({
          projectId: "project-1",
          triggerId: "trigger-1",
          dispatchId: "evt_stable",
          outcome: "success",
          responseStatus: 204,
          error: null,
          response: null,
        }),
      ]);
    });
  });

  describe("given a receiver that answers 503 with Retry-After", () => {
    /** @scenario "A webhook request's failure is classified for the caller's outbox and filed" */
    it("throws a retryable refusal carrying the floor and files the receiver's side", async () => {
      mockedSend.mockResolvedValue({
        status: 503,
        body: "busy",
        responseHeaders: {},
        retryAfterMs: 60_000,
      });
      const { log, requests } = requestsWith();

      const refusal = await requests.send(request()).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(DispatchError);
      expect(refusal).toMatchObject({ retryable: true, retryAfterMs: 60_000 });
      expect(log.attempts[0]).toMatchObject({
        outcome: "retryable",
        responseStatus: 503,
        error: 'Webhook for trigger "Settles" received HTTP 503: busy',
        response: { body: "busy", retryAfterMs: 60_000 },
      });
    });

    it("files a 4xx as terminal", async () => {
      mockedSend.mockResolvedValue({ status: 410, body: "gone", responseHeaders: {} });
      const { log, requests } = requestsWith();

      await expect(requests.send(request())).rejects.toMatchObject({ retryable: false });
      expect(log.attempts[0]?.outcome).toBe("terminal");
    });
  });

  describe("given a project over the hourly cap", () => {
    it("backs off retryably under main's key without contacting the receiver", async () => {
      const { limiter, log, requests } = requestsWith({ allowed: false });

      await expect(requests.send(request())).rejects.toMatchObject({ retryable: true });
      expect(limiter.scopes).toEqual(["project-1"]);
      expect(mockedSend).not.toHaveBeenCalled();
      expect(log.attempts[0]).toMatchObject({ outcome: "retryable", responseStatus: null });
    });
  });

  describe("given a destination inside a private or metadata range", () => {
    /** @scenario "A webhook request to a private address is refused before any connection" */
    it.each([
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "http://hooks.acme.test/in",
      "https://user:pass@hooks.acme.test/in",
    ])("refuses %s terminally, spends no cap and files the refusal", async (url) => {
      const { limiter, log, requests } = requestsWith();

      await expect(requests.send(request(url))).rejects.toMatchObject({ retryable: false });
      expect(mockedSend).not.toHaveBeenCalled();
      expect(limiter.scopes).toEqual([]);
      expect(log.attempts).toEqual([
        expect.objectContaining({ outcome: "terminal", responseStatus: null }),
      ]);
    });
  });

  describe("given a log write that fails", () => {
    it("still answers the attempt's own verdict", async () => {
      mockedSend.mockResolvedValue({ status: 200, body: "", responseHeaders: {} });
      const { log, requests } = requestsWith();
      log.recordRequestAttempt = () => Promise.reject(new Error("database down"));

      await expect(requests.send(request())).resolves.toMatchObject({ status: 200 });
    });
  });

  describe("given recorded attempts for a trigger", () => {
    /** @scenario "An automation reads its trigger's webhook attempts from the webhook module" */
    it("answers them by source, newest first as stored", async () => {
      const { log, requests } = requestsWith();
      const firedAt = Temporal.Instant.from("2026-09-30T10:00:00Z");
      log.rows = [
        {
          id: "row-1",
          projectId: "project-1",
          triggerId: "trigger-1",
          dispatchId: "evt_stable",
          outcome: "success",
          responseStatus: 200,
          latencyMs: 12,
          error: null,
          response: null,
          firedAt,
        },
      ];

      const rows = await requests.findBySource({
        projectId: "project-1",
        source: { module: "automation", ref: "trigger-1" },
        limit: 25,
      });

      expect(rows).toEqual([
        expect.objectContaining({
          id: "row-1",
          ref: "trigger-1",
          firedAt: new Date(firedAt.epochMilliseconds),
        }),
      ]);
    });
  });
});
