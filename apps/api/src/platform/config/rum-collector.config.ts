/**
 * Where this process forwards browser telemetry, read from the environment.
 *
 * A config module rather than a value on `api.config.ts`'s parsed record: the
 * ingest route asks again on every export, so a deployment that restates the
 * collector does not have to be recomposed for the change to take.
 */

/**
 * The collector the proxied export is forwarded to. Shares
 * `OTEL_EXPORTER_OTLP_ENDPOINT` with `instrumentation.node.ts`, so the browser's
 * telemetry lands beside the server's without a second thing to configure.
 * Unset means no collector, which is how the ingest route stays inert by default.
 */
export const collectorTracesUrl = (): string | undefined => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, "");
  return endpoint ? `${endpoint}/v1/traces` : void 0;
};

/**
 * Headers the collector needs to accept a forwarded export. The collector's
 * traces pipeline can sit behind a bearer filter; `instrumentation.node.ts`
 * gets that for free because the OTLP exporter reads the env var itself, but a
 * hand-rolled fetch has to pass it on or every forward 401s.
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
