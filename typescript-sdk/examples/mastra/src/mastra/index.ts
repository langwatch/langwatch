import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import { Observability } from "@mastra/observability";
import { OtelExporter } from "@mastra/otel-exporter";
import { weatherAgent } from "./agents/weather-agent";
import {
  completenessScorer,
  toolCallAppropriatenessScorer,
  translationScorer,
} from "./scorers/weather-scorer";
import { weatherWorkflow } from "./workflows/weather-workflow";

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent },
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra-example",
        exporters: [
          new OtelExporter({
            provider: {
              custom: {
                endpoint: `${process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai"}/api/otel/v1/traces`,
                headers: {
                  Authorization: `Bearer ${process.env.LANGWATCH_API_KEY}`,
                },
              },
            },
          }),
        ],
      },
    },
  }),
});
