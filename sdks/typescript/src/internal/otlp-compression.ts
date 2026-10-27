import { CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base";

/**
 * The compression an OTLP exporter is built with: the caller's choice, else
 * the standard OTel env vars (left to the exporter), else gzip. Explicit
 * config beats env in OTel JS, so gzip is only set when neither is given.
 */
export function resolveOtlpCompression({
  compression,
  signal,
}: {
  compression?: CompressionAlgorithm;
  signal: "TRACES" | "LOGS" | "METRICS";
}): CompressionAlgorithm | undefined {
  if (compression !== undefined) return compression;
  const isSetInEnv = [
    "OTEL_EXPORTER_OTLP_COMPRESSION",
    `OTEL_EXPORTER_OTLP_${signal}_COMPRESSION`,
  ].some((name) => process.env[name]?.trim());
  return isSetInEnv ? undefined : CompressionAlgorithm.GZIP;
}
