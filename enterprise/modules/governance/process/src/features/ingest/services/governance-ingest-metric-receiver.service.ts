// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { applyOtlpReceiverPolicy, parseOtlpMetrics } from "@langwatch/otlp";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";

import {
  countMetricDataPoints,
  hasMetricPayload,
  stampMetricOriginAttrs,
} from "../rules/governance-ingest-payload.rules.ts";
import type { GovernanceIngestLandingService } from "./governance-ingest-landing.service.ts";
import type {
  GovernanceIngestBatch,
  GovernanceIngestMetricReceipt,
  GovernanceIngestReceiverMembers,
} from "./governance-ingest-receiver.service.ts";

const logger = createLogger("langwatch:ingest");

/** `/v1/metrics`: an OTLP metric batch parsed, stamped and handed to the metric pipeline. */
export class GovernanceIngestMetricReceiverService {
  private constructor(
    private readonly members: Pick<GovernanceIngestReceiverMembers, "metricCollection">,
    private readonly landing: GovernanceIngestLandingService,
  ) {}

  static create({
    members,
    landing,
  }: {
    members: Pick<GovernanceIngestReceiverMembers, "metricCollection">;
    landing: GovernanceIngestLandingService;
  }): GovernanceIngestMetricReceiverService {
    return new GovernanceIngestMetricReceiverService(members, landing);
  }

  /**
   * The one signal that does NOT acknowledge every failure: a throw AFTER the
   * parse is ours rather than the sender's, so it answers retryably and the
   * source event is deliberately not recorded — the collector re-sends this
   * same request and must not double-count.
   */
  async receiveMetrics(batch: GovernanceIngestBatch): Promise<GovernanceIngestMetricReceipt> {
    const { source } = batch;

    let bodyBytes = 0;
    let metricCount = 0;
    let rejectedDataPoints = 0;
    let acceptedDataPoints = 0;
    let parseHint: string | undefined;

    try {
      const body = await batch.read();

      bodyBytes = body.byteLength;

      const parsed = parseOtlpMetrics(body, batch.contentType);

      if (!parsed.ok) {
        parseHint = parsed.error;
      } else {
        metricCount = countMetricDataPoints(parsed.request);

        if (hasMetricPayload(parsed.request)) {
          // Scoped away from the outer catch, which turns anything it sees
          // into a `hint` on an acknowledgement.
          const collected = await this.collectParsedMetrics(parsed.request, source);

          if (collected.outcome !== "ok") return collected;

          rejectedDataPoints = collected.rejectedDataPoints;
          acceptedDataPoints = collected.acceptedDataPoints;
          parseHint = collected.parseHint;
        }
      }
    } catch (err) {
      parseHint = String(err);
    }

    await this.landing.recordEvent(source);
    logger.info(
      { sourceId: source.id, bytes: bodyBytes, metrics: metricCount },
      "otel metrics ingest landed",
    );

    return {
      outcome: "received",
      bytes: bodyBytes,
      metrics: metricCount,
      acceptedDataPoints,
      rejectedDataPoints,
      hint: parseHint,
    };
  }

  /** Project resolution, provenance stamping and collection, in one step. */
  private async collectParsedMetrics(
    parsedRequest: IExportMetricsServiceRequest,
    source: GovernanceIngestionSource,
  ): Promise<
    | Readonly<{ outcome: "unavailable"; errorMessage?: string | undefined }>
    | Readonly<{ outcome: "error" }>
    | Readonly<{
        outcome: "ok";
        rejectedDataPoints: number;
        acceptedDataPoints: number;
        parseHint?: string | undefined;
      }>
  > {
    const { metricCollection } = this.members;

    try {
      const tenantId = await this.landing.governanceTenantOf(source);

      stampMetricOriginAttrs({ request: parsedRequest, source });
      applyOtlpReceiverPolicy({ request: parsedRequest, signal: "metrics", apiKeyId: null });

      const result = await metricCollection({
        tenantId,
        organizationId: source.organizationId,
        metricRequest: parsedRequest,
      });

      if (result.outcome === "unavailable") {
        return { outcome: "unavailable", errorMessage: result.errorMessage };
      }

      return {
        outcome: "ok",
        rejectedDataPoints: result.rejectedDataPoints,
        acceptedDataPoints: result.acceptedDataPoints,
        parseHint: result.errorMessage,
      };
    } catch (error) {
      logger.error(
        { error, sourceId: source.id },
        "otel metrics ingest failed after parsing; answering retryably",
      );

      return { outcome: "error" };
    }
  }
}
