/**
 * What main's entries set before anything minted an id (origin/main platform/app/src/server.mts):
 * every id carries the install's `<env>_` prefix, `local_` by default, so a deterministic id
 * (span record, evaluation run) is the string main wrote and an upgrade does not duplicate it.
 */
import { EventEmitter } from "node:events";
import process from "node:process";

import { Config, nodeEnvironment, parseProcessConfig } from "@langwatch/config";
import { setTraceUrlProvider } from "@langwatch/handled-error";
import { setEnvironment } from "@langwatch/ksuid";
import { grafanaLinksForTrace } from "@langwatch/observability/grafana-links";

import { observabilityOwner } from "./observability-owner.ts";
import type { PreambleEnvironment } from "./preamble.ts";

/** Main's ceiling, set in production only (server.mts:18-19). */
const MAX_LISTENERS = 128;

const nodeEnvironmentOwner = {
  name: "process",
  config: Config.define(() => ({ nodeEnvironment })),
} as const;

/** Process-global, so only the code that owns the Node process calls it. */
export function setProcessGlobals({ environment }: { environment: PreambleEnvironment }): void {
  const config = parseProcessConfig({
    owners: [observabilityOwner, nodeEnvironmentOwner],
    environment,
  });
  setEnvironment(config.observability.environment);
  // Main's error `trace` block links Grafana when GRAFANA_* is set; no links without it.
  const grafana = config.observability.grafana;
  setTraceUrlProvider((traceId) => grafanaLinksForTrace(traceId, grafana) ?? undefined);
  if (config.process.nodeEnvironment !== "production") return;
  process.setMaxListeners(MAX_LISTENERS);
  EventEmitter.defaultMaxListeners = MAX_LISTENERS;
}
