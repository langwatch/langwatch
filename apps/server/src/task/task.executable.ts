import process from "node:process";

import { configureLogger, type LoggerConfiguration } from "@langwatch/observability";
import {
  createProcessObservability,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { processLoggerConfiguration } from "@langwatch/process/observability-owner";

export type LocalTaskExecutableConfig = Readonly<{
  serviceName: string;
  environment: string;
  logger: LoggerConfiguration;
  deprecations: readonly string[];
}>;

export type LocalTaskExecution = Readonly<{
  taskName: string;
  args: readonly string[];
}>;

export abstract class LocalTaskExecutor {
  abstract execute(input: LocalTaskExecution): Promise<void>;
}

export interface LocalTaskExecutableHost {
  readonly argv: readonly string[];
  exit(code: number): void;
  writeStderr(message: string): void;
}

export type LocalTaskExecutableOptions = Readonly<{
  source: Readonly<Record<string, unknown>>;
  args: readonly string[];
  executor: LocalTaskExecutor;
  observability?: Omit<ProcessObservabilityOptions, "serviceName" | "loggerName">;
}>;

/** The local-orchestrator task root: parse, log, execute, flush, and exit. */
export class LocalTaskExecutable {
  static async run(options: LocalTaskExecutableOptions): Promise<void> {
    const config = resolveLocalTaskExecutableConfig(options.source);
    configureLogger(config.logger);
    const observability = createProcessObservability({
      serviceName: config.serviceName,
      loggerName: config.serviceName,
      setup: options.observability?.setup ?? {
        langwatch: "disabled",
        attributes: { "deployment.environment.name": config.environment },
      },
      flushers: options.observability?.flushers,
    });
    for (const deprecation of config.deprecations) observability.logger.warn(deprecation);
    const taskName = options.args[0] ?? "";

    try {
      await options.executor.execute({ taskName, args: options.args.slice(1) });
    } catch (error) {
      observability.logger.error({ error, taskName }, "failed");
      throw error;
    } finally {
      try {
        await observability.shutdown();
      } catch (error) {
        observability.logger.error({ error, taskName }, "failed to flush task observability");
      }
      observability.logger.info("done");
    }
  }
}

export async function runLocalTaskEntrypoint(options: {
  source: Readonly<Record<string, unknown>>;
  executor: LocalTaskExecutor;
  host?: LocalTaskExecutableHost;
}): Promise<void> {
  const host = options.host ?? nodeTaskExecutableHost();
  try {
    await LocalTaskExecutable.run({
      source: options.source,
      args: host.argv.slice(2),
      executor: options.executor,
    });
    host.exit(0);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    host.writeStderr(`[langwatch:task] fatal task failure: ${message}\n`);
    host.exit(1);
  }
}

export function resolveLocalTaskExecutableConfig(
  source: Readonly<Record<string, unknown>>,
): LocalTaskExecutableConfig {
  const { configuration, deprecations } = processLoggerConfiguration({
    environment: Object.fromEntries(
      Object.entries(source).map(([key, value]) => [
        key,
        typeof value === "string" ? value : void 0,
      ]),
    ),
    serviceName: "langwatch:task",
  });
  return {
    serviceName: configuration.serviceName,
    environment: configuration.deploymentEnvironment,
    logger: configuration,
    deprecations,
  };
}

function nodeTaskExecutableHost(): LocalTaskExecutableHost {
  return {
    argv: process.argv,
    exit: (code) => process.exit(code),
    writeStderr: (message) => process.stderr.write(message),
  };
}
