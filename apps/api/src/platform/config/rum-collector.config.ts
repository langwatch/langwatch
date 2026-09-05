/**
 * Where this process forwards browser telemetry, read from the environment.
 */

/**
 * The collector the proxied export is forwarded to. Shares `OTEL_EXPORTER_OTLP_ENDPOINT` with
 * `instrumentation.node.ts`, so the browser's telemetry lands beside the server's without a
 * second thing to configure.
 */
export const collectorTracesUrl = (): string | undefined => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, "");
  return endpoint ? `${endpoint}/v1/traces` : void 0;
};

/**
 * Headers the collector needs to accept a forwarded export.
 */
export function collectorHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  for (const pair of (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name && value) headers[name.toLowerCase()] = value;
  }
  return headers;
}
