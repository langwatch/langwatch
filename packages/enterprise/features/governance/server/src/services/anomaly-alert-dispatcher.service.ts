import { createHmac } from "node:crypto";
import {
  type AnomalyAlertDispatchInput,
  type AnomalyAlertDispatchOutcome,
  type AnomalyAlertDispatchResult,
  type Destination,
  safeParseDestinationConfig,
  type WebhookDestination,
} from "@langwatch/enterprise-governance-contract";
import type { AnomalyAlertHttpPort } from "../ports/anomaly-alert-http.port";
import {
  GovernanceDiagnosticsPort,
  NullGovernanceDiagnosticsPort,
} from "../ports/governance-diagnostics.port";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 250;

export class AnomalyAlertDispatcherService {
  private constructor(
    private readonly http: AnomalyAlertHttpPort,
    private readonly diagnostics: GovernanceDiagnosticsPort,
    private readonly timeoutMs: number,
    private readonly maxRetries: number,
    private readonly retryBackoffMs: number,
  ) {}

  static create(options: {
    http: AnomalyAlertHttpPort;
    diagnostics?: GovernanceDiagnosticsPort;
    timeoutMs?: number;
    maxRetries?: number;
    retryBackoffMs?: number;
  }): AnomalyAlertDispatcherService {
    return new AnomalyAlertDispatcherService(
      options.http,
      options.diagnostics ?? new NullGovernanceDiagnosticsPort(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
      options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
    );
  }

  async dispatchAlert(
    input: AnomalyAlertDispatchInput,
  ): Promise<AnomalyAlertDispatchResult> {
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

    const body = JSON.stringify(buildAlertPayload(input));
    const outcomes: AnomalyAlertDispatchOutcome[] = [];
    for (let index = 0; index < parsed.data.destinations.length; index++) {
      outcomes.push(
        await this.dispatchOne({
          destination: parsed.data.destinations[index]!,
          body,
          destinationIndex: index,
          ruleId: input.rule.id,
        }),
      );
    }
    return { dispatchTag: summariseOutcomes(outcomes), outcomes };
  }

  private async dispatchOne(input: {
    destination: Destination;
    body: string;
    destinationIndex: number;
    ruleId: string;
  }): Promise<AnomalyAlertDispatchOutcome> {
    if (input.destination.type !== "webhook") {
      return {
        destinationIndex: input.destinationIndex,
        type: "webhook",
        status: "failed",
        reason: "Unsupported destination type",
      };
    }
    return this.dispatchWebhook({ ...input, destination: input.destination });
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
        if (response.status < 500 || response.status >= 600) break;
      } catch (error) {
        lastError =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : `Unknown error: ${String(error)}`;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.maxRetries && this.retryBackoffMs > 0) {
        await sleep(this.retryBackoffMs * 2 ** attempt);
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
}

function buildAlertPayload(input: AnomalyAlertDispatchInput) {
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

function summariseOutcomes(outcomes: AnomalyAlertDispatchOutcome[]): string {
  const succeeded = outcomes.filter((outcome) => outcome.status === "succeeded").length;
  const failed = outcomes.length - succeeded;
  if (succeeded > 0 && failed === 0) return `dispatched_webhook_${succeeded}`;
  if (succeeded > 0) {
    return `dispatched_webhook_${succeeded}_failed_${failed}`;
  }
  return `failed_webhook_${failed}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
