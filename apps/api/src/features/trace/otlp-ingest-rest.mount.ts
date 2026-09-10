/**
 * Mounts the OTLP receiver and its path-alias family, in that order: the
 * alias forwards into the canonical family's own `MountableRestApp`, so it
 * cannot be mounted before the canonical family exists.
 */
import { bodyLimit, type MountableRestApp } from "@langwatch/api/rest";
import { OTLP_MAX_BODY_BYTES } from "@langwatch/otlp";
import type { OtlpIngestRestPorts } from "@langwatch/trace-contract";
import { otlpIngestRest } from "@langwatch/trace-server/api-rest/otlp-ingest";
import { otlpPathAliasRest } from "@langwatch/trace-server/api-rest/otlp-path-alias";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** `/api/otel/v1/*` and the misconfigured-exporter paths it also answers at. */
export function mountOtlpIngestRest(
  runtime: ApiRestRuntime,
  otlpIngest: OtlpIngestRestPorts,
): MountableRestApp[] {
  const canonical = runtime.mount(otlpIngestRest.router(), () => otlpIngest, {
    // The same cap the receiver's own body reader enforces, applied before a
    // declared oversized body is even downloaded.
    middleware: [bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES })],
  });

  const alias = runtime.mount(otlpPathAliasRest.router(), () => ({ canonical }));

  return [canonical, alias];
}
