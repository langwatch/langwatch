/**
 * The image spend probe's reads.
 *
 * The generic reads are shared with the audio probe: the budget ledger, the
 * budget total and the trace cost do not change with the modality, so they
 * are imported from ../audio/probeSpendReads rather than copied. Only the
 * spend row shape and the span read are specific to images, because they
 * name image quantities and image span names.
 *
 * Every read is bounded by the run's own start instant. gateway_spend,
 * gateway_budget_ledger_events and stored_spans are partitioned by their time
 * column and read under FINAL, so an unbounded predicate scans every
 * partition, cold storage included, for rows this run created seconds ago.
 */

import {
  clickhouse,
  type ProbeScope,
  readBudgetSpendNanoUsd,
  readLedgerDebits,
  readTraceCostUsd,
} from "../audio/probeSpendReads";

export type { LedgerDebit, ProbeScope } from "../audio/probeSpendReads";
export {
  clickhouse,
  readBudgetSpendNanoUsd,
  readLedgerDebits,
  readTraceCostUsd,
};

/** The image quantity columns migration 00089 adds. */
export const IMAGE_QUANTITY_COLUMNS = [
  "TokensInputImage",
  "TokensOutputImage",
  "ImageCount",
] as const;

export interface ImageSpendRow {
  GatewayRequestId: string;
  TraceId: string;
  Model: string;
  Status: string;
  TokensInput: string;
  TokensOutput: string;
  CostNanoUSD: string;
  inputImageTokens: number;
  outputImageTokens: number;
  imageCount: number;
}

/**
 * Abort before spending money if the migration has not landed: without the
 * columns every image quantity reads as zero, so the probe would measure the
 * defect it is meant to disprove and blame the code.
 */
export async function assertImageQuantityColumns(
  projectId: string,
): Promise<void> {
  const client = await clickhouse(projectId);
  const result = await client.query({
    query: "DESCRIBE TABLE gateway_spend",
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ name: string }>;
  const present = new Set(rows.map((r) => r.name));
  const missing = IMAGE_QUANTITY_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `gateway_spend is missing ${missing.join(", ")}. Apply migration ` +
        "00089_gateway_spend_image_quantities.sql before probing.",
    );
  }
}

/** This run's spend rows, with the image quantities each request carried. */
export async function readImageSpendRows(
  scope: ProbeScope,
): Promise<ImageSpendRow[]> {
  const client = await clickhouse(scope.projectId);
  const result = await client.query({
    query: `
      SELECT GatewayRequestId, TraceId, Model, Status,
             toString(TokensInput) AS TokensInput,
             toString(TokensOutput) AS TokensOutput,
             toString(CostNanoUSD) AS CostNanoUSD,
             toString(TokensInputImage) AS TokensInputImage,
             toString(TokensOutputImage) AS TokensOutputImage,
             toString(ImageCount) AS ImageCount
      FROM gateway_spend FINAL
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= {since:DateTime64(3)}
        AND VirtualKeyId = {vkId:String}
        AND Status IN ('confirmed', 'failed')
    `,
    query_params: {
      tenantId: scope.projectId,
      vkId: scope.vkId,
      since: scope.startedAt,
    },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<Record<string, string>>;
  return rows.map((r) => ({
    GatewayRequestId: String(r.GatewayRequestId ?? ""),
    TraceId: String(r.TraceId ?? ""),
    Model: String(r.Model ?? ""),
    Status: String(r.Status ?? ""),
    TokensInput: String(r.TokensInput ?? "0"),
    TokensOutput: String(r.TokensOutput ?? "0"),
    CostNanoUSD: String(r.CostNanoUSD ?? "0"),
    inputImageTokens: Number(r.TokensInputImage ?? 0),
    outputImageTokens: Number(r.TokensOutputImage ?? 0),
    imageCount: Number(r.ImageCount ?? 0),
  }));
}

export interface ImageSpanRow {
  SpanName: string;
  input: string;
  output: string;
}

/**
 * The LLM spans of one trace, with the content attributes the trace explorer
 * shows.
 *
 * `langwatch.input` and `langwatch.output` are the canonical content keys.
 * The gateway stamps the OpenTelemetry keys `gen_ai.input.messages` and
 * `gen_ai.output.messages` instead, and older spans carry `gen_ai.prompt` and
 * `gen_ai.completion`, so all of them are read.
 */
export async function readTraceSpans({
  scope,
  traceId,
}: {
  scope: ProbeScope;
  traceId: string;
}): Promise<ImageSpanRow[]> {
  const client = await clickhouse(scope.projectId);
  const result = await client.query({
    query: `
      SELECT SpanName,
             coalesce(
               nullIf(SpanAttributes['langwatch.input'], ''),
               nullIf(SpanAttributes['gen_ai.input.messages'], ''),
               nullIf(SpanAttributes['gen_ai.prompt'], ''),
               ''
             ) AS Input,
             coalesce(
               nullIf(SpanAttributes['langwatch.output'], ''),
               nullIf(SpanAttributes['gen_ai.output.messages'], ''),
               nullIf(SpanAttributes['gen_ai.completion'], ''),
               ''
             ) AS Output
      FROM stored_spans FINAL
      WHERE TenantId = {tenantId:String}
        AND StartTime >= {since:DateTime64(3)}
        AND TraceId = {traceId:String}
    `,
    query_params: {
      tenantId: scope.projectId,
      traceId,
      since: scope.startedAt,
    },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<Record<string, string>>;
  return rows.map((r) => ({
    SpanName: String(r.SpanName ?? ""),
    input: String(r.Input ?? ""),
    output: String(r.Output ?? ""),
  }));
}
