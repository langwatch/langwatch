// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  IngestionRateLimitedError,
  IngestionReceiverUnavailableError,
  IngestionSourceUnauthorizedError,
  IngestionWrongEndpointError,
  type GovernanceIngestHeaders,
  type GovernanceIngestOtlpInput,
  type GovernanceIngestReceipt,
  type GovernanceIngestResponse,
  type GovernanceIngestWebhookInput,
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
    if (gate.outcome !== "authorized") throw refusalOf(gate);

    const receipt = await this.#receiver.receiveTraces({
      source: gate.source,
      contentType: input.headers["content-type"] ?? void 0,
      read: () => decodeOtlpBody(input.raw, input.headers["content-encoding"] ?? null),
    });

    if (receipt.outcome === "wrong-endpoint") {
      throw new IngestionWrongEndpointError(
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
    if (gate.outcome !== "authorized") throw refusalOf(gate);

    const receipt = await this.#receiver.receiveWebhook({ source: gate.source, body: input.raw });

    if (receipt.outcome === "wrong-endpoint") {
      throw new IngestionWrongEndpointError(
        "Webhook path is only valid for workato, otel_generic, and s3_custom (callback-mode) sources",
      );
    }

    return accepted({ accepted: true, bytes: receipt.bytes, eventId: receipt.eventId });
  }

  async receiveOtlpLogs(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    const gate = await this.#authorize(input);
    if (gate.outcome !== "authorized") throw refusalOf(gate);

    const receipt = await this.#receiver.receiveLogs({
      source: gate.source,
      contentType: input.headers["content-type"] ?? void 0,
      read: () => decodeOtlpBody(input.raw, input.headers["content-encoding"] ?? null),
    });

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
    if (gate.outcome !== "authorized") throw refusalOf(gate);

    const receipt = await this.#receiver.receiveMetrics({
      source: gate.source,
      contentType: input.headers["content-type"] ?? void 0,
      read: () => decodeOtlpBody(input.raw, input.headers["content-encoding"] ?? null),
    });

    if (receipt.outcome === "unavailable" || receipt.outcome === "error") {
      throw new IngestionReceiverUnavailableError();
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

function refusalOf(
  gate: Exclude<GovernanceIngestAuthorization, { outcome: "authorized" }>,
): IngestionRateLimitedError | IngestionSourceUnauthorizedError {
  return gate.outcome === "rate-limited"
    ? new IngestionRateLimitedError({ retryAfterSec: gate.retryAfterSec })
    : new IngestionSourceUnauthorizedError();
}
