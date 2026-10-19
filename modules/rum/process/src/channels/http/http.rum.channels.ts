import { createLogger } from "@langwatch/observability";
import type { RumConfig } from "@langwatch/rum-contract";
import { rumSecrets } from "@langwatch/rum-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import {
  COLLECTOR_VARIABLES,
  collectorHeaders,
  collectorTargetOf,
  DEPRECATED_COLLECTOR_VARIABLES,
} from "../../rules/rum-ingest.rules.ts";
import type { RumChannels } from "../rum.channels.ts";
import { HttpRumCollectorChannel } from "./http.rum-collector.channel.ts";

/** Browser traces are forwarded over OTLP/HTTP to the collector the deployment names, if any. */
export class HttpRumChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: RumConfig;
    secrets: ScopedSecrets;
  }): Promise<RumChannels> {
    const target = await secrets.into(rumSecrets.collectorHeaders, (rawHeaders) =>
      secrets.into(rumSecrets.telemetryHeaders, (rawTelemetryHeaders) =>
        collectorTargetOf({
          own: { endpoint: config.collectorEndpoint, headers: collectorHeaders(rawHeaders) },
          telemetry: {
            endpoint: config.telemetryEndpoint,
            headers: collectorHeaders(rawTelemetryHeaders),
          },
        }),
      ),
    );
    if (!target.configured) return { collector: { configured: false } };
    if (target.deprecated) {
      createLogger("langwatch:rum").warn(
        { deprecated: DEPRECATED_COLLECTOR_VARIABLES, replacements: COLLECTOR_VARIABLES },
        `Browser telemetry is forwarding to ${DEPRECATED_COLLECTOR_VARIABLES.join(" and ")}, which are deprecated for it; set ${COLLECTOR_VARIABLES.join(" and ")}`,
      );
    }
    const channel = HttpRumCollectorChannel.create({
      tracesUrl: target.tracesUrl,
      headers: target.headers,
    });
    return { collector: { configured: true, channel } };
  }
}
