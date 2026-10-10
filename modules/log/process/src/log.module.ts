import type { LogApi, LogServerConfig } from "@langwatch/log-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { LogModule } from "./app/log.app.ts";
import { logEventing } from "./eventing/log.pipeline.ts";
import { logRepositories } from "./repositories/log-repositories.registry.ts";
import { otlpLogsDoor, otlpLogsRest } from "./transport/otlp-logs.rest.ts";

export const logProcessModule: PublishedProcessModule<"log", LogApi, LogServerConfig> =
  defineProcessModule("log")
    .withRepositories(logRepositories)
    .withApi(LogModule)
    .withTransports(otlpLogsRest)
    .withEventing(logEventing)
    // The exporter's key, resolved through Trace before the body (W02-DOOR-SHAPE, 2026-10-10).
    .withDoors({ otlp_ingest: otlpLogsDoor });
