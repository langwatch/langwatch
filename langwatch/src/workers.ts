import { loadEnvConfig } from "@next/env";
import { createLogger } from "./utils/logger";
import { setupObservability } from "langwatch/observability/node";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { WorkersRestart } from "./server/background/errors";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

loadEnvConfig(process.cwd());

const logger = createLogger("langwatch:workers");

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  setupObservability({
    attributes: {
      "deployment.environment.name": process.env.NODE_ENV,
      "service.name": "langwatch-workers",
      "service.instance.id": process.env.INSTANCE_ID,
    },
    spanProcessors: [
      process.env.NODE_ENV === "production"
        ? new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`,
          })
        )
        : new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`,
          })
        ),
    ],
    instrumentations: [getNodeAutoInstrumentations()],
  });
}

logger.info("starting");

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server/background/worker")
  .start(void 0, 15 * 60 * 1000)
  .catch((error: Error) => {
    if (error instanceof WorkersRestart) {
      logger.info({ error }, "worker restart");
      process.exit(0);
    }

    logger.error({ error }, "error running worker");
    process.exit(1);
  });

// Global error handlers for uncaught exceptions and unhandled promise rejections
process.on("uncaughtException", (err) => {
  logger.fatal({ error: err }, "uncaught exception detected");

  // If a graceful shutdown is not achieved after 3 seconds,
  // shut down the process completely
  setTimeout(() => {
    process.abort(); // exit immediately and generate a core dump file
  }, 3000).unref();
});

process.on("unhandledRejection", (reason, promise) => {
  logger.fatal(
    { reason: reason instanceof Error ? reason : { value: reason }, promise },
    "unhandled rejection detected"
  );
});
