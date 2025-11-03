import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { openai } from "@ai-sdk/openai";
import { OtelExporter } from "@mastra/otel-exporter";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";

export const mastra = new Mastra({
  agents: {
    assistant: new Agent({
      name: "assistant",
      instructions: "You are a helpful assistant.",
      model: openai("gpt-5"),
    }),
  },
  // Storage is required for tracing in Mastra
  storage: new LibSQLStore({ url: ":memory:" }), // +
  logger: new PinoLogger({ name: "mastra", level: "info" }), // +
  observability: {
    configs: {
      otel: {
        serviceName: "<project_name>",
        exporters: [
          new OtelExporter({
            provider: {
              custom: {
                endpoint: "https://app.langwatch.ai/api/otel/v1/traces", // +
                headers: { "Authorization": `Bearer ${process.env.LANGWATCH_API_KEY}` }, // +
              },
            },
          }),
        ],
      },
    },
  },
});
