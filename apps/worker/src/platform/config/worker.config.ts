import {
  Config,
  environmentBooleanSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

const producerOnlyEventingSchema = environmentBooleanSchema
  .default(false)
  .refine((enabled) => !enabled, "Eventing consumers are not enabled in Wave 1.");

export const workerConfigDefinition = RuntimeConfig.define({
  /** A standalone worker owns background consumer behaviour once installed. */
  processRole: Config.value(z.literal("worker").default("worker"), { env: "WORKER_PROCESS_ROLE" }),
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    {
      env: "NODE_ENV",
    },
  ),
  serviceName: Config.value(z.string().min(1).default("langwatch:worker"), {
    env: "WORKER_SERVICE_NAME",
  }),
  serviceVersion: Config.value(z.string().min(1).optional(), {
    env: "SERVICE_VERSION",
  }),
  logger: {
    format: Config.value(z.enum(["pretty", "json"]).optional(), { env: "LOG_FORMAT" }),
    level: Config.value(z.string().min(1).optional(), { env: "LOG_LEVEL" }),
    consoleLevel: Config.value(z.string().min(1).optional(), { env: "LOG_CONSOLE_LEVEL" }),
    otelExportEnabled: Config.value(environmentBooleanSchema.optional(), {
      env: "LOG_OTEL_EXPORT_ENABLED",
    }),
  },
  observability: {
    apiKey: Config.secret({ optional: true, env: "LANGWATCH_API_KEY" }),
    endpoint: Config.url({ optional: true, env: "LANGWATCH_ENDPOINT" }),
    processorType: Config.value(z.enum(["simple", "batch"]).default("batch"), {
      env: "LANGWATCH_PROCESSOR_TYPE",
    }),
  },
  eventing: {
    /** Explicitly fail closed until the complete shared queue registry moves. */
    consumersEnabled: Config.value(producerOnlyEventingSchema, {
      env: "WORKER_EVENTING_CONSUMERS_ENABLED",
    }),
  },
});

export type WorkerConfig = ConfigValue<typeof workerConfigDefinition>;

export function resolveWorkerConfig(source: Readonly<Record<string, unknown>>): WorkerConfig {
  return RuntimeConfig.create({
    name: "worker",
    definition: workerConfigDefinition,
    source,
  }).value;
}
