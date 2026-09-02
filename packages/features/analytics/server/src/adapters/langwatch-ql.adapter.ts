/**
 * Process composition binds the restricted LangWatchQL identity to its service.
 *
 * The connection arrives from the process rather than being read here: the
 * identity a statement runs as is a deployment credential, and the one place
 * this repository reads the environment is a process's own configuration
 * module. A process that has no such identity composes the service anyway and
 * `available` answers false — which is what the workbench's navigation gate
 * reads, so an unprovisioned deployment never offers a surface it would refuse.
 */
import { createLangWatchQLExecutor, type LangWatchQLConnection } from "../langwatch-ql/executor";
import {
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "../services/langwatch-ql.service";

export class LangWatchQLAdapter {
  static create(
    options: {
      /** The restricted identity, or `null` where a deployment provisioned none. */
      connection: LangWatchQLConnection | null;
    } & Partial<Omit<LangWatchQLServiceDependencies, "executor" | "database">>,
  ): LangWatchQLService {
    const { connection, ...overrides } = options;
    return new LangWatchQLService({
      executor: connection ? createLangWatchQLExecutor(connection) : null,
      database: connection?.database ?? DEFAULT_LWQL_DATABASE,
      ...overrides,
    });
  }
}
