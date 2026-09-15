/**
 * Process composition binds the restricted LangWatchQL identity to its service.
 */
import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLExecutorService } from "./langwatch-ql-executor.service.ts";
import {
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "./langwatch-ql.service.ts";
import { ClickHouseLangWatchQLExecutorAdapter } from "../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";

const executorService = LangWatchQLExecutorService.create();

/**
 * The composed LangWatchQL service, cached at module scope rather than on the
 * app container so test suites can swap the executor between describe blocks
 * without a full app teardown and rebuild.
 */
let cached: LangWatchQLService | null = null;

export class LangWatchQLAdapter {
  static create(
    options: {
      /** The restricted identity, or `null` where a deployment provisioned none. */
      connection: LangWatchQLConnection | null;
    } & Partial<Omit<LangWatchQLServiceDependencies, "executor" | "database">>,
  ): LangWatchQLService {
    const { connection, ...overrides } = options;

    return LangWatchQLService.create({
      executor: connection ? ClickHouseLangWatchQLExecutorAdapter.create({ connection }) : null,
      database: connection?.database ?? DEFAULT_LWQL_DATABASE,
      ...overrides,
    });
  }

  /** Builds the service from an environment a process handed over. */
  static fromEnvironment(
    environment: Record<string, string | undefined>,
    overrides: Partial<LangWatchQLServiceDependencies> = {},
  ): LangWatchQLService {
    return LangWatchQLAdapter.create({
      connection: executorService.tryConnectionFromEnvironment(environment),
      ...overrides,
    });
  }

  /** The process-wide service, built from the environment on first use. */
  static shared(environment: Record<string, string | undefined>): LangWatchQLService {
    cached ??= LangWatchQLAdapter.fromEnvironment(environment);

    return cached;
  }

  /**
   * Replaces the process-wide service, or clears it so the next read rebuilds
   * from the environment.
   */
  static setShared(service: LangWatchQLService | null): void {
    cached = service;
  }

  /** Clears the process-wide service, releasing the transport it holds first. */
  static async closeShared(): Promise<void> {
    const previous = cached;
    cached = null;
    await previous?.close();
  }
}
