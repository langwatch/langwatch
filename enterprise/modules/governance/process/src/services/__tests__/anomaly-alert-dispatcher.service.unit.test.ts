import { createHmac } from "node:crypto";

import { InMemoryProcessStore, type IntentContext } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WebhookApi, WebhookDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type {
  AnomalyAlertHttpClient,
  AnomalyAlertHttpResponse,
} from "../../channels/anomaly-alert.channel.ts";
import {
  OutboxAnomalyAlertDelivery,
  requestAnomalyAlertDelivery,
} from "../../eventing/anomaly-alert-delivery.intent.ts";
import {
  ANOMALY_ALERT_DELIVERY_PROCESS_KEY,
  ANOMALY_ALERT_DELIVERY_PROCESS_NAME,
  type AnomalyAlertDeliveryIntent,
} from "../../eventing/anomaly-alert-delivery.process.ts";
import { AnomalyAlertDispatcherService } from "../anomaly-alert-dispatcher.service.ts";

type Call = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

class RecordingHttp implements AnomalyAlertHttpClient {
  readonly calls: Call[] = [];

  constructor(
    private readonly respond: (
      call: Call,
      index: number,
    ) => AnomalyAlertHttpResponse | Promise<AnomalyAlertHttpResponse>,
  ) {}

  async post(input: Call & { signal: AbortSignal }) {
    const call = {
      url: input.url,
      headers: input.headers,
      body: input.body,
    };
    this.calls.push(call);
    return this.respond(call, this.calls.length - 1);
  }
}

function dispatchInput(destinationConfig: Record<string, unknown> = {}) {
  return {
    rule: {
      id: "rule-1",
      name: "Spend spike",
      ruleType: "spend_spike",
      severity: "warning",
      organizationId: "organization-1",
      destinationConfig,
    },
    alert: {
      id: "alert-1",
      triggerWindowStart: new Date("2026-08-24T10:00:00.000Z"),
      triggerWindowEnd: new Date("2026-08-24T11:00:00.000Z"),
      triggerSpendUsd: "123.456",
      triggerEventCount: null,
      detail: { reason: "test" },
      detectedAt: new Date("2026-08-24T11:00:01.000Z"),
    },
  };
}

function createDispatcher(http: AnomalyAlertHttpClient) {
  return AnomalyAlertDispatcherService.create({
    http,
    retryBackoffMs: 0,
  });
}

describe("AnomalyAlertDispatcherService", () => {
  it("posts the structured alert to an HTTPS destination", async () => {
    const http = new RecordingHttp(() => ({
      status: 200,
      ok: true,
      statusText: "OK",
    }));
    const result = await createDispatcher(http).dispatchAlert(
      dispatchInput({
        destinations: [{ type: "webhook", url: "https://hooks.test/alert" }],
      }),
    );

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(http.calls[0]!.body)).toMatchObject({
      ruleId: "rule-1",
      alert: { id: "alert-1", triggerSpendUsd: "123.456" },
    });
    expect(result.dispatchTag).toBe("dispatched_webhook_1");
  });

  /** @scenario "Anomaly delivery delegates network safety" */
  /** @scenario "An inline webhook destination keeps delivering as before" */
  it("signs the exact request body when a shared secret is configured", async () => {
    const http = new RecordingHttp(() => ({
      status: 200,
      ok: true,
      statusText: "OK",
    }));
    await createDispatcher(http).dispatchAlert(
      dispatchInput({
        destinations: [
          {
            type: "webhook",
            url: "https://hooks.test/signed",
            sharedSecret: "secret",
          },
        ],
      }),
    );

    const call = http.calls[0]!;
    const expected = createHmac("sha256", "secret").update(call.body).digest("hex");
    expect(call.headers["X-LangWatch-Signature"]).toBe(`sha256=${expected}`);
  });

  /** @scenario "Anomaly delivery delegates network safety" */
  it("retries 5xx responses but not 4xx responses", async () => {
    const transient = new RecordingHttp((_call, index) => ({
      status: index === 0 ? 503 : 200,
      ok: index > 0,
      statusText: index === 0 ? "Unavailable" : "OK",
    }));
    const permanent = new RecordingHttp(() => ({
      status: 401,
      ok: false,
      statusText: "Unauthorized",
    }));
    const input = dispatchInput({
      destinations: [{ type: "webhook", url: "https://hooks.test/alert" }],
    });

    await expect(createDispatcher(transient).dispatchAlert(input)).resolves.toMatchObject({
      dispatchTag: "dispatched_webhook_1",
    });
    const permanentResult = await createDispatcher(permanent).dispatchAlert(input);

    expect(transient.calls).toHaveLength(2);
    expect(permanent.calls).toHaveLength(1);
    expect(permanentResult.outcomes[0]).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("401"),
    });
  });

  /** @scenario "Anomaly delivery delegates network safety" */
  it("continues fan-out when one destination exhausts retries", async () => {
    const http = new RecordingHttp((call) => ({
      status: call.url.includes("primary") ? 500 : 200,
      ok: !call.url.includes("primary"),
      statusText: call.url.includes("primary") ? "Failed" : "OK",
    }));
    const result = await createDispatcher(http).dispatchAlert(
      dispatchInput({
        destinations: [
          { type: "webhook", url: "https://primary.test/alert" },
          { type: "webhook", url: "https://backup.test/alert" },
        ],
      }),
    );

    expect(http.calls.filter((call) => call.url.includes("primary"))).toHaveLength(3);
    expect(http.calls.filter((call) => call.url.includes("backup"))).toHaveLength(1);
    expect(result.dispatchTag).toBe("dispatched_webhook_1_failed_1");
  });

  it("uses log-only delivery for empty or malformed configuration", async () => {
    const http = new RecordingHttp(() => ({
      status: 200,
      ok: true,
      statusText: "OK",
    }));
    const dispatcher = createDispatcher(http);

    await expect(dispatcher.dispatchAlert(dispatchInput())).resolves.toEqual({
      dispatchTag: "log_only",
      outcomes: [],
    });
    await expect(
      dispatcher.dispatchAlert(dispatchInput({ slack_channel: "#operations" })),
    ).resolves.toEqual({
      dispatchTag: "log_only_invalid_config",
      outcomes: [],
    });
    expect(http.calls).toHaveLength(0);
  });
});

describe("given a rule whose destination is a registered webhook endpoint", () => {
  const endpointConfig = { destinations: [{ type: "webhook_endpoint", endpointId: "endpoint-1" }] };

  function withOutbox() {
    const processStore = InMemoryProcessStore.createForTesting();
    const outbox = OutboxAnomalyAlertDelivery.create(processStore);
    const http = new RecordingHttp(() => ({ status: 200, ok: true, statusText: "OK" }));
    const dispatcher = AnomalyAlertDispatcherService.create({
      http,
      outbox: () => outbox,
      retryBackoffMs: 0,
    });
    const recorded = async () =>
      processStore.findMessagesByRef({
        ref: {
          processName: ANOMALY_ALERT_DELIVERY_PROCESS_NAME,
          projectId: "organization-1",
          processKey: ANOMALY_ALERT_DELIVERY_PROCESS_KEY,
        },
      });
    return { dispatcher, http, recorded };
  }

  describe("when the rule fires an alert", () => {
    /** @scenario "A rule delivering to a webhook endpoint records one deliver intent per alert" */
    it("records one deliver intent keyed by the alert and endpoint, and posts nothing", async () => {
      const { dispatcher, http, recorded } = withOutbox();

      const result = await dispatcher.dispatchAlert(dispatchInput(endpointConfig));
      await dispatcher.dispatchAlert(dispatchInput(endpointConfig));

      expect(http.calls).toHaveLength(0);
      expect(result.outcomes).toEqual([
        { destinationIndex: 0, type: "webhook_endpoint", status: "queued" },
      ]);
      const messages = await recorded();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        messageKey: "anomaly-alert:alert-1:endpoint-1",
        payload: { endpointId: "endpoint-1", alertId: "alert-1", ruleId: "rule-1" },
      });
    });
  });

  describe("when an inline destination the migration annotated fires an alert", () => {
    /** @scenario "A migrated inline destination delivers through its endpoint" */
    it("records the deliver intent for the endpoint and posts nothing inline", async () => {
      const { dispatcher, http, recorded } = withOutbox();
      const migrated = {
        destinations: [
          { type: "webhook", url: "https://siem.example.test/hook", endpointId: "endpoint-1" },
        ],
      };

      const result = await dispatcher.dispatchAlert(dispatchInput(migrated));

      expect(http.calls).toHaveLength(0);
      expect(result.outcomes).toEqual([
        { destinationIndex: 0, type: "webhook_endpoint", status: "queued" },
      ]);
      expect(await recorded()).toHaveLength(1);
    });
  });

  describe("when no outbox is connected in this process", () => {
    /** @scenario "A rule delivering to a webhook endpoint records one deliver intent per alert" */
    it("reports the destination as failed rather than dropping it silently", async () => {
      const dispatcher = AnomalyAlertDispatcherService.create({
        http: new RecordingHttp(() => ({ status: 200, ok: true, statusText: "OK" })),
      });

      const result = await dispatcher.dispatchAlert(dispatchInput(endpointConfig));

      expect(result.outcomes[0]).toMatchObject({ type: "webhook_endpoint", status: "failed" });
    });
  });

  describe("when the recorded intent runs twice", () => {
    /** @scenario "A deliver intent asks the webhook module once per alert, however often it runs" */
    it("requests delivery under the same idempotency key both times", async () => {
      const requests: WebhookDeliveryRequest[] = [];
      const webhooks = createApiFixture<WebhookApi>({
        requestDelivery: async (request) => {
          requests.push(request);
          return { deliveryId: "evt_1" };
        },
      });
      const intent: AnomalyAlertDeliveryIntent = {
        organizationId: "organization-1",
        ruleId: "rule-1",
        alertId: "alert-1",
        endpointId: "endpoint-1",
        body: { ruleId: "rule-1" },
      };

      const context: IntentContext = {
        processName: "anomalyAlertDelivery",
        projectId: "organization-1",
        processKey: "anomaly-alerts",
        tenantId: "organization-1",
        messageKey: "anomaly-alert:alert-1:endpoint-1",
        attempt: 1,
      };

      await requestAnomalyAlertDelivery(webhooks)(intent, context);
      await requestAnomalyAlertDelivery(webhooks)(intent, { ...context, attempt: 2 });

      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual(requests[1]);
      expect(requests[0]).toMatchObject({
        organizationId: "organization-1",
        destinationId: "endpoint-1",
        message: {
          type: "governance.anomaly_alert.triggered",
          idempotencyKey: "anomaly-alert:alert-1:endpoint-1",
          body: { ruleId: "rule-1" },
        },
        source: { module: "governance", ref: "rule-1" },
      });
    });
  });
});
