/**
 * AnomalyAlertDispatcher — C3 alert dispatch fan-out.
 *
 * Called by `spendSpikeAnomalyEvaluator` after an alert is persisted
 * in PG. Walks the rule's `destinationConfig.destinations` array and
 * POSTs a structured JSON payload to each webhook with a bounded
 * retry budget (best-effort).
 *
 * Best-effort by design: dispatch is observability, not the source of
 * truth. The AnomalyAlert row itself is the authoritative signal —
 * the dashboard's recentAnomalies query reads it regardless of
 * dispatch success. A permanent webhook failure logs but does NOT
 * fail the evaluator job.
 *
 * Spec: specs/ai-gateway/governance/c3-alert-dispatch.feature
 */
import { createHmac } from "node:crypto";

import type { AnomalyAlert, AnomalyRule } from "@prisma/client";

import { createLogger } from "~/utils/logger/server";

import {
  safeParseDestinationConfig,
  type Destination,
  type WebhookDestination,
} from "./destinationConfig.schema";

const logger = createLogger("langwatch:anomaly-alert-dispatcher");

const WEBHOOK_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 250;

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; ok: boolean; statusText: string }>;

export type DispatchOutcome =
  | { destinationIndex: number; type: "webhook"; status: "succeeded" }
  | { destinationIndex: number; type: "webhook"; status: "failed"; reason: string };

export type DispatchResult = {
  /** Tag written to AnomalyAlert.detail.dispatch for audit/UX. */
  dispatchTag: string;
  outcomes: DispatchOutcome[];
};

export class AnomalyAlertDispatcherService {
  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  static create(fetchImpl?: FetchLike): AnomalyAlertDispatcherService {
    return new AnomalyAlertDispatcherService(fetchImpl);
  }

  async dispatchAlert({
    rule,
    alert,
  }: {
    rule: AnomalyRule;
    alert: AnomalyAlert;
  }): Promise<DispatchResult> {
    const parsed = safeParseDestinationConfig(rule.destinationConfig);
    if (!parsed.ok) {
      // Legacy / malformed config — quarantine, do not POST anywhere.
      // Mirrors the threshold-config quarantine path from `1f4ddd04c`.
      logger.warn(
        {
          ruleId: rule.id,
          organizationId: rule.organizationId,
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        "anomaly rule destinationConfig failed strict validation — falling back to log-only. Re-save the rule from the admin UI to repair, or archive it.",
      );
      return { dispatchTag: "log_only_invalid_config", outcomes: [] };
    }

    if (parsed.data.destinations.length === 0) {
      return { dispatchTag: "log_only", outcomes: [] };
    }

    const payload = buildAlertPayload({ rule, alert });
    const body = JSON.stringify(payload);

    const outcomes: DispatchOutcome[] = [];
    for (let i = 0; i < parsed.data.destinations.length; i++) {
      const dest = parsed.data.destinations[i]!;
      const outcome = await this.dispatchOne({
        destination: dest,
        body,
        destinationIndex: i,
        ruleId: rule.id,
      });
      outcomes.push(outcome);
    }
    return { dispatchTag: summariseOutcomes(outcomes), outcomes };
  }

  private async dispatchOne({
    destination,
    body,
    destinationIndex,
    ruleId,
  }: {
    destination: Destination;
    body: string;
    destinationIndex: number;
    ruleId: string;
  }): Promise<DispatchOutcome> {
    if (destination.type !== "webhook") {
      // Discriminator schema only allows "webhook" today; this
      // branch keeps the exhaustiveness for future destinations.
      return {
        destinationIndex,
        type: "webhook",
        status: "failed",
        reason: `Unsupported destination type`,
      };
    }
    return this.dispatchWebhook({ destination, body, destinationIndex, ruleId });
  }

  private async dispatchWebhook({
    destination,
    body,
    destinationIndex,
    ruleId,
  }: {
    destination: WebhookDestination;
    body: string;
    destinationIndex: number;
    ruleId: string;
  }): Promise<DispatchOutcome> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "LangWatch-Anomaly-Dispatcher/1.0",
    };
    if (destination.sharedSecret) {
      const signature = createHmac("sha256", destination.sharedSecret)
        .update(body)
        .digest("hex");
      headers["X-LangWatch-Signature"] = `sha256=${signature}`;
    }

    let lastError: string | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const res = await this.fetchImpl(destination.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          return { destinationIndex, type: "webhook", status: "succeeded" };
        }
        // Retry on 5xx; fail fast on 4xx (config-time error, not transient).
        const transient = res.status >= 500 && res.status < 600;
        lastError = `HTTP ${res.status} ${res.statusText}`;
        if (!transient) break;
      } catch (err) {
        clearTimeout(timer);
        lastError =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : `Unknown error: ${String(err)}`;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
      }
    }

    logger.warn(
      {
        ruleId,
        destinationIndex,
        url: destination.url,
        reason: lastError,
      },
      "anomaly alert webhook dispatch failed after retries",
    );
    return {
      destinationIndex,
      type: "webhook",
      status: "failed",
      reason: lastError ?? "unknown error",
    };
  }
}

function buildAlertPayload({
  rule,
  alert,
}: {
  rule: AnomalyRule;
  alert: AnomalyAlert;
}): Record<string, unknown> {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    severity: rule.severity,
    organizationId: rule.organizationId,
    alert: {
      id: alert.id,
      triggerWindowStartIso: alert.triggerWindowStart.toISOString(),
      triggerWindowEndIso: alert.triggerWindowEnd.toISOString(),
      triggerSpendUsd: alert.triggerSpendUsd?.toString() ?? null,
      triggerEventCount: alert.triggerEventCount,
      detail: alert.detail,
      detectedAtIso: alert.detectedAt.toISOString(),
    },
  };
}

function summariseOutcomes(outcomes: DispatchOutcome[]): string {
  const succeeded = outcomes.filter((o) => o.status === "succeeded").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  if (succeeded > 0 && failed === 0) return `dispatched_webhook_${succeeded}`;
  if (succeeded > 0 && failed > 0) {
    return `dispatched_webhook_${succeeded}_failed_${failed}`;
  }
  return `failed_webhook_${failed}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  return {
    status: res.status,
    ok: res.ok,
    statusText: res.statusText,
  };
};
