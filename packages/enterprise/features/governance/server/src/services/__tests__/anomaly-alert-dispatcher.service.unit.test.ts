import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AnomalyAlertHttpPort,
  type AnomalyAlertHttpResponse,
} from "../../ports/anomaly-alert-http.port";
import { AnomalyAlertDispatcherService } from "../anomaly-alert-dispatcher.service";

type Call = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

class RecordingHttpPort extends AnomalyAlertHttpPort {
  readonly calls: Call[] = [];

  constructor(
    private readonly respond: (
      call: Call,
      index: number,
    ) => AnomalyAlertHttpResponse | Promise<AnomalyAlertHttpResponse>,
  ) {
    super();
  }

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

function createDispatcher(http: AnomalyAlertHttpPort) {
  return AnomalyAlertDispatcherService.create({
    http,
    retryBackoffMs: 0,
  });
}

describe("AnomalyAlertDispatcherService", () => {
  it("posts the structured alert to an HTTPS destination", async () => {
    const http = new RecordingHttpPort(() => ({
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

  it("signs the exact request body when a shared secret is configured", async () => {
    const http = new RecordingHttpPort(() => ({
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

  it("retries 5xx responses but not 4xx responses", async () => {
    const transient = new RecordingHttpPort((_call, index) => ({
      status: index === 0 ? 503 : 200,
      ok: index > 0,
      statusText: index === 0 ? "Unavailable" : "OK",
    }));
    const permanent = new RecordingHttpPort(() => ({
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

  it("continues fan-out when one destination exhausts retries", async () => {
    const http = new RecordingHttpPort((call) => ({
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
    const http = new RecordingHttpPort(() => ({
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
