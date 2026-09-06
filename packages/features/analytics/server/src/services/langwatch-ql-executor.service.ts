/**
 * What the LangWatchQL executor seam needs decided outside a transport: how much of a finished
 * result reaches the caller, and whether this deployment provisioned a restricted identity at
 * all.
 */
import { createLogger } from "@langwatch/observability";

import type {
  LangWatchQLConnection,
  LangWatchQLResultLimits,
} from "../ports/langwatch-ql-executor.port.ts";

const logger = createLogger("langwatch:analytics:lwql:executor");

export type { LangWatchQLColumn, LangWatchQLStatistics } from "@langwatch/analytics-contract";

/**
 * The shipped result ceilings.
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
   * Applies the row ceiling, then the byte ceiling, reporting whether either bit. Byte cost is
   * measured on the JSON encoding of each retained row, which is what the response body
   * actually carries.
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
   * Reads the restricted identity's connection out of the environment a process handed over, or
   * reports that this deployment has none.
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
