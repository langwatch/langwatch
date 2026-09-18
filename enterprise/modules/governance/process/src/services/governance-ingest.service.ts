// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  GovernanceIngestHeaders,
  GovernanceIngestOtlpInput,
  GovernanceIngestReceipt,
  GovernanceIngestResponse,
  GovernanceIngestWebhookInput,
} from "@langwatch/enterprise-governance-contract";
import { decodeOtlpBody } from "@langwatch/otlp";

import type {
  GovernanceIngestAccessApi,
  GovernanceIngestAuthorization,
} from "./governance-ingest-access.service.ts";
import type { GovernanceIngestReceiverApi } from "./governance-ingest-receiver.service.ts";

type GovernanceIngestServiceMembers = Readonly<{
  access: GovernanceIngestAccessApi;
  receiver: GovernanceIngestReceiverApi;
}>;

export class GovernanceIngestService {
  #access: GovernanceIngestAccessApi;
  #receiver: GovernanceIngestReceiverApi;

  private constructor(members: GovernanceIngestServiceMembers) {
    this.#access = members.access;
    this.#receiver = members.receiver;
  }

  static create(members: GovernanceIngestServiceMembers): GovernanceIngestService {
    return new GovernanceIngestService(members);
  }

  async receiveOtlpTraces(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    const gate = await this.#authorize(input);
    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await this.#receiver.receiveTraces({
      source: gate.source,
      contentType: input.headers["content-type"] ?? void 0,
      read: () => decodeOtlpBody(input.raw, input.headers["content-encoding"] ?? null),
    });

    if (receipt.outcome === "wrong-endpoint") {
      return wrongEndpoint(
        "OTLP path is only valid for otel_generic, claude_cowork, and claude_code sources",
      );
    }

    const body: GovernanceIngestReceipt = {
      accepted: true,
      bytes: receipt.bytes,
      events: receipt.events,
    };

    if (receipt.rejectedSpans > 0) body.rejectedSpans = receipt.rejectedSpans;

    if (receipt.events === 0 && (receipt.hint || receipt.bytes > 0)) {
      body.hint = receipt.hint
        ? `Body did not parse as OTLP/HTTP: ${receipt.hint}. See https://docs.langwatch.ai/observability/trace-vs-activity-ingestion for the canonical shape.`
        : "Body received but no spans extracted. OTLP/HTTP expects " +
          "resource_spans[].scope_spans[].spans[] with non-empty spans " +
          "arrays. See https://docs.langwatch.ai/ai-gateway/governance/" +
          "ingestion-sources/otel-generic for a copy-paste curl.";
    }

    return accepted(body);
  }

  async receiveWebhook(input: GovernanceIngestWebhookInput): Promise<GovernanceIngestResponse> {
    const gate = await this.#authorize(input);
    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await this.#receiver.receiveWebhook({ source: gate.source, body: input.raw });

    if (receipt.outcome === "not-served") return notServed("webhook events");

    if (receipt.outcome === "wrong-endpoint") {
      return wrongEndpoint(
        "Webhook path is only valid for workato, otel_generic, and s3_custom (callback-mode) sources",
      );
    }

    return accepted({ accepted: true, bytes: receipt.bytes, eventId: receipt.eventId });
  }

  async receiveOtlpLogs(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    const gate = await this.#authorize(input);
    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await this.#receiver.receiveLogs({
      source: gate.source,
      contentType: input.headers["content-type"] ?? void 0,
      read: () => decodeOtlpBody(input.raw, input.headers["content-encoding"] ?? null),
    });

    if (receipt.outcome === "not-served") return notServed("OTLP logs");

    const body: GovernanceIngestReceipt = {
      accepted: true,
      bytes: receipt.bytes,
      logRecords: receipt.logRecords,
      costEvents: receipt.costEvents,
      ledgerRows: receipt.ledgerRows,
    };

    if (receipt.hint) body.hint = receipt.hint;

    return accepted(body);
  }

  async receiveOtlpMetrics(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    const gate = await this.#authorize(input);
    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await this.#receiver.receiveMetrics({
      source: gate.source,
      contentType: input.headers["content-type"] ?? void 0,
      read: () => decodeOtlpBody(input.raw, input.headers["content-encoding"] ?? null),
    });

    if (receipt.outcome === "not-served") return notServed("OTLP metrics");

    if (receipt.outcome === "unavailable") {
      return refused(
        {
          accepted: false,
          error: receipt.errorMessage ?? "ingestion receiver is temporarily unavailable",
        },
        503,
      );
    }

    if (receipt.outcome === "error") {
      return refused({ accepted: false, error: "failed to record data point" }, 503);
    }

    const body: GovernanceIngestReceipt = {
      accepted: true,
      bytes: receipt.bytes,
      metrics: receipt.metrics,
      acceptedDataPoints: receipt.acceptedDataPoints,
      partialSuccess: {
        rejectedDataPoints: receipt.rejectedDataPoints,
        ...(receipt.hint ? { errorMessage: receipt.hint } : {}),
      },
    };

    if (receipt.hint) body.hint = receipt.hint;

    return accepted(body);
  }

  #authorize(input: { sourceId: string; headers: GovernanceIngestHeaders }) {
    return this.#access.authorize({ headers: toHeaders(input.headers), sourceId: input.sourceId });
  }
}

function toHeaders(input: GovernanceIngestHeaders): Headers {
  return new Headers(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== void 0),
  );
}

function accepted(body: GovernanceIngestReceipt): GovernanceIngestResponse {
  return { status: 202, body, headers: {} };
}

function refused(
  body: { accepted?: false; error: string; error_description?: string },
  status: 400 | 401 | 404 | 429 | 503,
  headers: Record<string, string> = {},
): GovernanceIngestResponse {
  return { status, body, headers };
}

function refuseGate(
  gate: Exclude<GovernanceIngestAuthorization, { outcome: "authorized" }>,
): GovernanceIngestResponse {
  if (gate.outcome === "rate-limited") {
    return refused(
      {
        error: "rate_limited",
        error_description:
          "Too many requests from this client. Slow down and retry after the Retry-After window.",
      },
      429,
      { "Retry-After": String(gate.retryAfterSec) },
    );
  }

  return refused({ error: "unauthorized" }, 401);
}

function notServed(signal: string): GovernanceIngestResponse {
  return refused(
    {
      error: "not_served",
      error_description: `This deployment does not receive ${signal} on an ingestion source.`,
    },
    404,
  );
}

function wrongEndpoint(description: string): GovernanceIngestResponse {
  return refused({ error: "wrong_endpoint", error_description: description }, 400);
}
