// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import type { AnomalyAlert, AnomalyRule } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { sendGovernanceAlertEmail } from "~/server/mailer/governanceAlertEmail";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

import {
  type Destination,
  type EmailDestination,
  safeParseDestinationConfig,
  type WebhookDestination,
} from "./destinationConfig.schema";
import { resolveActiveOrganizationMemberEmails } from "./organizationMemberEmails";

const logger = createLogger("langwatch:anomaly-alert-dispatcher");

const WEBHOOK_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 250;

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; ok: boolean; statusText: string }>;

export type DispatchOutcome =
  | { destinationIndex: number; type: "webhook"; status: "succeeded" }
  | {
      destinationIndex: number;
      type: "webhook";
      status: "failed";
      reason: string;
    }
  | {
      destinationIndex: number;
      type: "email";
      status: "succeeded" | "partial_failure";
      acceptedCount: number;
      failedCount: number;
      totalCount: number;
    }
  | {
      destinationIndex: number;
      type: "email";
      status: "failed";
      reason: string;
      acceptedCount?: number;
      failedCount?: number;
      totalCount?: number;
    };

export type SendGovernanceAlertEmailLike = typeof sendGovernanceAlertEmail;
export type ListOrganizationMemberEmails = (
  organizationId: string,
) => Promise<string[]>;

export type DispatchResult = {
  /** Tag written to AnomalyAlert.detail.dispatch for audit/UX. */
  dispatchTag: string;
  outcomes: DispatchOutcome[];
};

export class AnomalyAlertDispatcherService {
  constructor(
    private readonly fetchImpl: FetchLike = defaultFetch,
    private readonly sendEmailImpl: SendGovernanceAlertEmailLike = sendGovernanceAlertEmail,
    private readonly listOrganizationMemberEmails: ListOrganizationMemberEmails = defaultListOrganizationMemberEmails,
  ) {}

  static create(
    fetchImpl?: FetchLike,
    sendEmailImpl?: SendGovernanceAlertEmailLike,
    listOrganizationMemberEmails?: ListOrganizationMemberEmails,
  ): AnomalyAlertDispatcherService {
    return new AnomalyAlertDispatcherService(
      fetchImpl,
      sendEmailImpl,
      listOrganizationMemberEmails,
    );
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
      let outcome: DispatchOutcome;
      try {
        outcome = await this.dispatchOne({
          destination: dest,
          body,
          destinationIndex: i,
          rule,
          alert,
        });
      } catch {
        logger.warn(
          { ruleId: rule.id, destinationIndex: i, type: dest.type },
          "anomaly alert destination dispatch failed",
        );
        outcome =
          dest.type === "email"
            ? {
                destinationIndex: i,
                type: "email",
                status: "failed",
                reason: "destination dispatch failed",
                acceptedCount: 0,
                failedCount: dest.to.length,
                totalCount: dest.to.length,
              }
            : {
                destinationIndex: i,
                type: "webhook",
                status: "failed",
                reason: "destination dispatch failed",
              };
      }
      outcomes.push(outcome);
    }
    return { dispatchTag: summariseOutcomes(outcomes), outcomes };
  }

  private async dispatchOne({
    destination,
    body,
    destinationIndex,
    rule,
    alert,
  }: {
    destination: Destination;
    body: string;
    destinationIndex: number;
    rule: AnomalyRule;
    alert: AnomalyAlert;
  }): Promise<DispatchOutcome> {
    if (destination.type === "email") {
      return this.dispatchEmail({
        destination,
        destinationIndex,
        rule,
        alert,
      });
    }
    return this.dispatchWebhook({
      destination,
      body,
      destinationIndex,
      ruleId: rule.id,
    });
  }

  private async dispatchEmail({
    destination,
    destinationIndex,
    rule,
    alert,
  }: {
    destination: EmailDestination;
    destinationIndex: number;
    rule: AnomalyRule;
    alert: AnomalyAlert;
  }): Promise<DispatchOutcome> {
    const memberEmails = new Set(
      (await this.listOrganizationMemberEmails(rule.organizationId)).map(
        (email) => email.toLowerCase(),
      ),
    );
    if (destination.to.some((address) => !memberEmails.has(address))) {
      return {
        destinationIndex,
        type: "email",
        status: "failed",
        reason: "recipient is not an active organization member",
        acceptedCount: 0,
        failedCount: destination.to.length,
        totalCount: destination.to.length,
      };
    }

    const dashboardUrl = `${(env.BASE_HOST ?? "https://app.langwatch.ai").replace(/\/$/, "")}/governance`;
    const results = await Promise.allSettled(
      destination.to.map((to) =>
        this.sendEmailImpl({
          to,
          monitorName: "Activity Monitor",
          ruleName: rule.name,
          source: safeSourceLabel(rule),
          windowStartIso: alert.triggerWindowStart.toISOString(),
          windowEndIso: alert.triggerWindowEnd.toISOString(),
          dashboardUrl,
        }),
      ),
    );
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length === 0) {
      return {
        destinationIndex,
        type: "email",
        status: "succeeded",
        acceptedCount: results.length,
        failedCount: 0,
        totalCount: results.length,
      };
    }

    logger.warn(
      { ruleId: rule.id, destinationIndex, failed: failed.length },
      "anomaly alert email dispatch failed",
    );
    return {
      destinationIndex,
      type: "email",
      status: failed.length === results.length ? "failed" : "partial_failure",
      reason: `${failed.length} of ${results.length} email deliveries failed`,
      acceptedCount: results.length - failed.length,
      failedCount: failed.length,
      totalCount: results.length,
    };
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
  const succeeded = outcomes.filter(
    (o) => o.status === "succeeded" || o.status === "partial_failure",
  ).length;
  const failed = outcomes.filter(
    (o) => o.status === "failed" || o.status === "partial_failure",
  ).length;
  const types = [...new Set(outcomes.map((outcome) => outcome.type))];
  const type = types.length === 1 ? types[0] : "destinations";
  if (succeeded > 0 && failed === 0) return `dispatched_${type}_${succeeded}`;
  if (succeeded > 0 && failed > 0) {
    return `dispatched_${type}_${succeeded}_failed_${failed}`;
  }
  return `failed_${type}_${failed}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SSRF-safe by default: an `anomalyRules:manage` admin sets the webhook URL,
// so a raw fetch could be pointed at cloud IMDS, the internal gateway, or any
// in-cluster service. ssrfSafeFetch resolves and pins the destination IP and
// blocks private/link-local hosts when BLOCK_LOCAL_HTTP_CALLS is set (SaaS),
// the same guard the ingestion pullers already use. A blocked host throws and
// surfaces as a dispatch failure, which is the intended outcome.
const defaultFetch: FetchLike = async (url, init) => {
  const res = await ssrfSafeFetch(url, init);
  return {
    status: res.status,
    ok: res.ok,
    statusText: res.statusText,
  };
};

const defaultListOrganizationMemberEmails: ListOrganizationMemberEmails =
  async (organizationId) =>
    resolveActiveOrganizationMemberEmails({ prisma, organizationId });

function safeSourceLabel(rule: AnomalyRule): string {
  if (rule.scope === "source") return "Configured ingestion source";
  if (rule.scope === "source_type") return `Source type: ${rule.scopeId}`;
  if (rule.scope === "team") return "All sources in the configured team";
  if (rule.scope === "project") return "All sources in the configured project";
  return "All organization sources";
}
