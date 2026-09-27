import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/**
 * Where the proxied export goes. Unset, rum falls back to observability's
 * deprecated `OTEL_EXPORTER_OTLP_*` collector and warns once at boot; with
 * neither, the door refuses as not configured.
 */
export const rumConfig = Config.define((c) => ({
  collectorEndpoint: c.env(
    "RUM_COLLECTOR_ENDPOINT",
    z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional()),
  ),
}));

export type RumConfig = ConfigOf<typeof rumConfig>;

/** The collector's auth headers, `key=value,key2=value2`: a credential, never a config field. */
export const rumSecrets = {
  collectorHeaders: Secret.load("RUM_COLLECTOR_HEADERS", { optional: true }),
} as const;
