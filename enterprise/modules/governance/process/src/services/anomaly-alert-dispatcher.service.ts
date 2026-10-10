import { createHmac } from "node:crypto";

import {
  type AnomalyAlertDispatchInput,
  type AnomalyAlertDispatchOutcome,
  type AnomalyAlertDispatchResult,
  type Destination,
  safeParseDestinationConfig,
  type WebhookDestination,
} from "@langwatch/enterprise-governance-contract";

import type { AnomalyAlertHttpClient } from "../channels/anomaly-alert.channel.ts";
import type { GovernanceDiagnosticsSink } from "./governance-policy.service.ts";
import { silentGovernanceDiagnostics } from "./governance-policy.service.ts";

/** Records one deliver intent in governance's outbox; a repeated key is one intent (ADR-167). */
export interface AnomalyAlertDeliveryOutbox {
  record(input: {
    organizationId: string;
    ruleId: string;
    alertId: string;
    endpointId: string;
    body: Record<string, unknown>;
  }): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 250;

export class AnomalyAlertDispatcherService {
  private readonly http: AnomalyAlertHttpClient;
  private readonly outbox: () => AnomalyAlertDeliveryOutbox | undefined;
  private readonly diagnostics: GovernanceDiagnosticsSink;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  private constructor({
    http,
    outbox,
    diagnostics,
    timeoutMs,
    maxRetries,
    retryBackoffMs,
  }: {
    http: AnomalyAlertHttpClient;
    outbox: () => AnomalyAlertDeliveryOutbox | undefined;
    diagnostics: GovernanceDiagnosticsSink;
    timeoutMs: number;
    maxRetries: number;
    retryBackoffMs: number;
  }) {
    this.http = http;
    this.outbox = outbox;
    this.diagnostics = diagnostics;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryBackoffMs = retryBackoffMs;
  }

  static create(options: {
    http: AnomalyAlertHttpClient;
    /** Read at dispatch: the outbox exists once the worker has built governance's pipeline. */
    outbox?: () => AnomalyAlertDeliveryOutbox | undefined;
    diagnostics?: GovernanceDiagnosticsSink;
    timeoutMs?: number;
    maxRetries?: number;
    retryBackoffMs?: number;
  }): AnomalyAlertDispatcherService {
    return new AnomalyAlertDispatcherService({
      http: options.http,
      outbox: options.outbox ?? (() => undefined),
      diagnostics: options.diagnostics ?? silentGovernanceDiagnostics,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBackoffMs: options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
    });
  }

  async dispatchAlert(input: AnomalyAlertDispatchInput): Promise<AnomalyAlertDispatchResult> {
    const parsed = safeParseDestinationConfig(input.rule.destinationConfig);
    if (!parsed.ok) {
      this.diagnostics.warn(
        "Anomaly destination configuration is invalid; using log-only delivery",
        {
          ruleId: input.rule.id,
          organizationId: input.rule.organizationId,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      );

      return { dispatchTag: "log_only_invalid_config", outcomes: [] };
    }

    if (parsed.data.destinations.length === 0) {
      return { dispatchTag: "log_only", outcomes: [] };
    }

    const payload = AnomalyAlertDispatcherService.alertPayload(input);
    const body = JSON.stringify(payload);
    const outcomes: AnomalyAlertDispatchOutcome[] = [];
    for (let index = 0; index < parsed.data.destinations.length; index++) {
      outcomes.push(
        await this.dispatchOne({
          destination: parsed.data.destinations[index]!,
          body,
          payload,
          destinationIndex: index,
          rule: input.rule,
          alertId: input.alert.id,
        }),
      );
    }

    return { dispatchTag: AnomalyAlertDispatcherService.summariseOutcomes(outcomes), outcomes };
  }

  private async dispatchOne(input: {
    destination: Destination;
    body: string;
    payload: Record<string, unknown>;
    destinationIndex: number;
    rule: AnomalyAlertDispatchInput["rule"];
    alertId: string;
  }): Promise<AnomalyAlertDispatchOutcome> {
    if (input.destination.type === "webhook_endpoint") {
      return this.recordEndpointDelivery({ ...input, endpointId: input.destination.endpointId });
    }
    if (input.destination.endpointId !== undefined) {
      return this.recordEndpointDelivery({ ...input, endpointId: input.destination.endpointId });
    }

    return this.dispatchWebhook({
      destination: input.destination,
      body: input.body,
      destinationIndex: input.destinationIndex,
      ruleId: input.rule.id,
    });
  }

  /** Nothing is posted here: the intent's handler asks WebhookApi.requestDelivery after commit. */
  private async recordEndpointDelivery(input: {
    endpointId: string;
    payload: Record<string, unknown>;
    destinationIndex: number;
    rule: AnomalyAlertDispatchInput["rule"];
    alertId: string;
  }): Promise<AnomalyAlertDispatchOutcome> {
    const outbox = this.outbox();
    if (!outbox) {
      return {
        destinationIndex: input.destinationIndex,
        type: "webhook_endpoint",
        status: "failed",
        reason: "Webhook endpoint delivery has no outbox in this process",
      };
    }
    await outbox.record({
      organizationId: input.rule.organizationId,
      ruleId: input.rule.id,
      alertId: input.alertId,
      endpointId: input.endpointId,
      body: input.payload,
    });
    return { destinationIndex: input.destinationIndex, type: "webhook_endpoint", status: "queued" };
  }

  private async dispatchWebhook(input: {
    destination: WebhookDestination;
    body: string;
    destinationIndex: number;
    ruleId: string;
  }): Promise<AnomalyAlertDispatchOutcome> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "LangWatch-Anomaly-Dispatcher/1.0",
    };
    if (input.destination.sharedSecret) {
      const signature = createHmac("sha256", input.destination.sharedSecret)
        .update(input.body)
        .digest("hex");
      headers["X-LangWatch-Signature"] = `sha256=${signature}`;
    }

    let lastError: string | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.http.post({
          url: input.destination.url,
          headers,
          body: input.body,
          signal: controller.signal,
        });
        if (response.ok) {
          return {
            destinationIndex: input.destinationIndex,
            type: "webhook",
            status: "succeeded",
          };
        }

        lastError = `HTTP ${response.status} ${response.statusText}`;
        if (response.status < 500 || response.status >= 600) {
          break;
        }
      } catch (error) {
        lastError =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : `Unknown error: ${String(error)}`;
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.maxRetries && this.retryBackoffMs > 0) {
        await AnomalyAlertDispatcherService.sleep(this.retryBackoffMs * 2 ** attempt);
      }
    }

    this.diagnostics.warn("Anomaly webhook delivery exhausted its retries", {
      ruleId: input.ruleId,
      destinationIndex: input.destinationIndex,
      url: input.destination.url,
      reason: lastError,
    });

    return {
      destinationIndex: input.destinationIndex,
      type: "webhook",
      status: "failed",
      reason: lastError ?? "unknown error",
    };
  }

  private static alertPayload(input: AnomalyAlertDispatchInput): Record<string, unknown> {
    return {
      ruleId: input.rule.id,
      ruleName: input.rule.name,
      ruleType: input.rule.ruleType,
      severity: input.rule.severity,
      organizationId: input.rule.organizationId,
      alert: {
        id: input.alert.id,
        triggerWindowStartIso: input.alert.triggerWindowStart.toISOString(),
        triggerWindowEndIso: input.alert.triggerWindowEnd.toISOString(),
        triggerSpendUsd: input.alert.triggerSpendUsd,
        triggerEventCount: input.alert.triggerEventCount,
        detail: input.alert.detail,
        detectedAtIso: input.alert.detectedAt.toISOString(),
      },
    };
  }

  private static summariseOutcomes(outcomes: AnomalyAlertDispatchOutcome[]): string {
    const queued = outcomes.filter((outcome) => outcome.status === "queued").length;
    if (queued > 0) {
      const failedEndpoints = outcomes.filter((outcome) => outcome.status === "failed").length;
      const delivered = outcomes.length - queued - failedEndpoints;
      return `queued_webhook_endpoint_${queued}_dispatched_${delivered}_failed_${failedEndpoints}`;
    }
    const succeeded = outcomes.filter((outcome) => outcome.status === "succeeded").length;
    const failed = outcomes.length - succeeded;
    if (succeeded > 0 && failed === 0) {
      return `dispatched_webhook_${succeeded}`;
    }

    if (succeeded > 0) {
      return `dispatched_webhook_${succeeded}_failed_${failed}`;
    }

    return `failed_webhook_${failed}`;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
