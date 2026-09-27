import { ClickHouseLangWatchQLExecutorRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
/**
 * Process composition binds the restricted LangWatchQL identity to its service.
 */
import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLExecutorService } from "../services/langwatch-ql-executor.service.ts";
import {
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "../services/langwatch-ql.service.ts";

const executorService = LangWatchQLExecutorService.create();

/**
 * The composed LangWatchQL service, cached at module scope rather than on the
 * app container so test suites can swap the executor between describe blocks
 * without a full app teardown and rebuild.
 */
let cached: LangWatchQLService | null = null;

export function createLangWatchQLService(
  options: {
    /** The restricted identity, or `null` where a deployment provisioned none. */
    connection: LangWatchQLConnection | null;
  } & Partial<Omit<LangWatchQLServiceDependencies, "executor" | "database">>,
): LangWatchQLService {
  const { connection, ...overrides } = options;

  return LangWatchQLService.create({
    executor: connection ? ClickHouseLangWatchQLExecutorRepository.create({ connection }) : null,
    database: connection?.database ?? DEFAULT_LWQL_DATABASE,
    ...overrides,
  });
}

/** Builds the service from an environment a process handed over. */
export function langWatchQLServiceFromEnvironment(
  environment: Record<string, string | undefined>,
  overrides: Partial<LangWatchQLServiceDependencies> = {},
): LangWatchQLService {
  return createLangWatchQLService({
    connection: executorService.parseConnectionFromEnvironment(environment),
    ...overrides,
  });
}

/** The process-wide service, built from the environment on first use. */
export function sharedLangWatchQLService(
  environment: Record<string, string | undefined>,
): LangWatchQLService {
  cached ??= langWatchQLServiceFromEnvironment(environment);

  return cached;
}

/**
 * Replaces the process-wide service, or clears it so the next read rebuilds
 * from the environment.
 */
export function setSharedLangWatchQLService(service: LangWatchQLService | null): void {
  cached = service;
}

/** Clears the process-wide service, releasing the transport it holds first. */
export async function closeSharedLangWatchQLService(): Promise<void> {
  const previous = cached;
  cached = null;
  await previous?.close();
}
