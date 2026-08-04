/**
 * LWQL — the LangWatch Query Layer.
 *
 * See issue #6346 and ADR-081. `getLwqlService()` is the seam both transports
 * use; nothing outside this module should reach for the compiler directly, or
 * the tenant-scoping and gating guarantees stop being centralised.
 */

export { AGGREGATION_NAMES, ENTITIES, ENTITY_NAMES } from "./catalog";
export { LwqlError, type LwqlErrorCode } from "./errors";
export { type LwqlQuery, lwqlQuerySchema } from "./ir";
export type {
  LwqlExecutionOptions,
  LwqlRequest,
  LwqlResult,
  LwqlResultMeta,
  VisibilityCutoffResolver,
} from "./lwql.service";
export { describeCatalogue, LwqlService } from "./lwql.service";
export { parseLwql } from "./parser";

import { getVisibilityCutoffMsForProject } from "~/server/api/utils";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";

import { LwqlService } from "./lwql.service";

let instance: LwqlService | undefined;

/**
 * Process-wide service instance, wired to the real ClickHouse resolver and the
 * real visibility-window resolver.
 */
export const getLwqlService = (): LwqlService => {
  instance ??= new LwqlService(
    getClickHouseClientForProject,
    getVisibilityCutoffMsForProject,
  );
  return instance;
};
