import {
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";

import type { LangWatchQLAccessModelAnswer } from "../repositories/langwatch-ql-access-model-answer.repository.ts";
import type { LangWatchQLRouter } from "../repositories/langwatch-ql-executor.repository.ts";

/** One row, if the reader can see any: the view is keyed by tenant, so none is expected. */
const PROBE_SQL = "SELECT 1 AS visible FROM traces LIMIT 1";

/**
 * Asks a private ClickHouse whether its access model is in place, as the organisation's derived
 * reader and never an admin (ADR-200). With the empty capability the reader must log in, see
 * `traces` and carry the tenant setting, and the row policy must show it no row.
 */
export class LangWatchQLPrivateAccessModelProbeService {
  private constructor(private readonly router: LangWatchQLRouter) {}

  static create({
    router,
  }: {
    router: LangWatchQLRouter;
  }): LangWatchQLPrivateAccessModelProbeService {
    return new LangWatchQLPrivateAccessModelProbeService(router);
  }

  /** Throws where the route cannot be resolved or the server cannot be reached to decide. */
  async probe({
    projectIds,
  }: {
    projectIds: readonly string[];
  }): Promise<LangWatchQLAccessModelAnswer> {
    const { executor } = await this.router.resolveRoute({ tenantIds: projectIds });
    try {
      const { rows } = await executor.execute({
        sql: PROBE_SQL,
        tenantCapability: "",
        projectIds: [],
      });
      return rows.length === 0 ? "provisioned" : "not_provisioned";
    } catch (error) {
      const isGap =
        error instanceof LangWatchQLUnavailableError ||
        error instanceof LangWatchQLProvisioningIncompleteError;
      if (isGap) return "not_provisioned";
      throw error;
    }
  }
}
