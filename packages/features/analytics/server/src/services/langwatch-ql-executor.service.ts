/**
 * What the LangWatchQL executor seam needs decided outside a transport: how
 * much of a finished result reaches the caller, and whether this deployment
 * provisioned a restricted identity at all.
 *
 * The transport itself is `../adapters/clickhouse.langwatch-ql-executor.adapter.ts`,
 * behind `../ports/langwatch-ql-executor.port.ts`.
 */
import { createLogger } from "@langwatch/observability";

import type {
  LangWatchQLConnection,
  LangWatchQLResultLimits,
} from "../ports/langwatch-ql-executor.port";

const logger = createLogger("langwatch:analytics:lwql:executor");

export type { LangWatchQLColumn, LangWatchQLStatistics } from "@langwatch/analytics-contract";

/**
 * The shipped result ceilings.
 *
 * Sized so a full page of an analytical answer fits comfortably — the shapes
 * the issue enumerates aggregate to tens or hundreds of rows — while a query
 * that forgot to aggregate is cut off long before the response becomes
 * something a caller has to stream.
 */
export const DEFAULT_LWQL_RESULT_LIMITS: LangWatchQLResultLimits = {
  maxRows: 10_000,
  maxResultBytes: 8_000_000,
};

export class LangWatchQLExecutorService {
  static create(): LangWatchQLExecutorService {
    return new LangWatchQLExecutorService();
  }

  private constructor() {}

  /**
   * Applies the row ceiling, then the byte ceiling, reporting whether either bit.
   *
   * Byte cost is measured on the JSON encoding of each retained row, which is
   * what the response body actually carries. It is an accounting of the
   * *result*, not of the query: the rows were already materialised by the time
   * this runs, so this bounds what a caller receives rather than what the
   * gateway holds. Bounding the latter is the database's job and it already
   * does it, with `max_memory_usage` pinned `CONST` by the profile.
   */
  applyResultLimits({
    rows,
    limits,
  }: {
    rows: readonly Record<string, unknown>[];
    limits: LangWatchQLResultLimits;
  }): { rows: Record<string, unknown>[]; truncated: boolean } {
    const capped = rows.slice(0, limits.maxRows);
    let truncated = capped.length < rows.length;

    const kept: Record<string, unknown>[] = [];
    let bytes = 0;
    for (const row of capped) {
      bytes += JSON.stringify(row)?.length ?? 0;
      if (bytes > limits.maxResultBytes) {
        truncated = true;
        break;
      }

      kept.push(row);
    }

    return { rows: kept, truncated };
  }

  /**
   * Reads the restricted identity's connection out of the environment a process
   * handed over, or reports that this deployment has none.
   *
   * `null` rather than a throw, and rather than a default pointing at the
   * application's own ClickHouse: an unconfigured deployment must refuse
   * LangWatchQL queries, and a partially-configured one must refuse them too.
   * Every field is required for exactly that reason.
   *
   * The two cases are indistinguishable to a caller and must not be to an
   * operator, so a partial configuration is logged with the names it is
   * missing. They are not read through the validated env module: the variables
   * are optional by design — most deployments provision no LangWatchQL identity
   * — and an optional entry there would not reject a misspelling either, while
   * making them required would refuse to boot every deployment that does not
   * run this API.
   */
  tryConnectionFromEnvironment(
    environment: Record<string, string | undefined>,
  ): LangWatchQLConnection | null {
    const url = environment.LWQL_CLICKHOUSE_URL;
    const username = environment.LWQL_CLICKHOUSE_USER;
    const password = environment.LWQL_CLICKHOUSE_PASSWORD;
    const database = environment.LWQL_DATABASE;
    const tenantSetting = environment.LWQL_TENANT_SETTING;

    const required = [
      ["LWQL_CLICKHOUSE_URL", url],
      ["LWQL_CLICKHOUSE_USER", username],
      ["LWQL_CLICKHOUSE_PASSWORD", password],
      ["LWQL_DATABASE", database],
      ["LWQL_TENANT_SETTING", tenantSetting],
    ] as const;
    const absent = required.filter(([, value]) => !value).map(([name]) => name);

    if (absent.length > 0) {
      // A deployment that set *some* of these meant to enable the API and got a
      // silent refusal on every query instead, so name what is missing. One that
      // set none is simply not running the API and says nothing. Variable names
      // only, never their values — one of these is a password.
      if (absent.length < required.length) {
        logger.warn(
          { absent },
          "LangWatchQL is partially configured, so every query will be refused",
        );
      }

      return null;
    }

    // Re-checked rather than asserted: `absent` is computed by a callback, which
    // TypeScript cannot use to narrow these five, and reaching for `!` here would
    // silently outlive someone editing the list above.
    if (!url || !username || !password || !database || !tenantSetting) {
      return null;
    }

    return { url, username, password, database, tenantSetting };
  }
}
