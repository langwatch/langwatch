/**
 * This process's composition of the operator-only ClickHouse EXPLAIN endpoint
 * (`@langwatch/ops-server`). The dedicated ClickHouse account this composes is
 * wired into the ops module's own application at boot (`installApiOps`); this
 * file's own remaining job is mounting `/api/ops/clickhouse/explain` over that
 * SAME application through `runtime.mount`.
 */
import { type MountableRestApp } from "@langwatch/api/rest";
import type { OpsApi } from "@langwatch/ops-contract";
import {
  opsClickHouseExplainRest,
  OpsClickHouseRuntime,
  OpsExplainClickHouseRepository,
  OpsExplainService,
  type OpsExplainClientResolution,
  type OpsExplainClients,
} from "@langwatch/ops-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** The operator application the EXPLAIN family answers from. */
export type OpsClickHouseExplainRestPorts = Readonly<{ ops: () => OpsApi }>;

/** The family's collaborators and the connection they hold, or nothing. */
export type ApiOpsExplainRest = Readonly<{
  /** The ClickHouse account an operator EXPLAIN runs as, fed into `installApiOps`. */
  clients: OpsExplainClients;
  /** The deployment's own operator secret, compared in constant time by the app. */
  opsApiKey: string;
  /** Whether this deployment is production, for the app's fail-closed rule. */
  isProduction: boolean;
  /** Released with the process: the lazily-opened ops ClickHouse client. */
  close(): Promise<void>;
}>;

/**
 * Composes the EXPLAIN endpoint's dedicated account, or answers nothing. Both
 * conditions are structural rather than defensive.
 */
export function composeApiOpsExplainRest(options: {
  /** `CLICKHOUSE_OPS_URL`, blank-is-unconfigured. */
  opsClickHouseUrl: string | undefined;
  /** `LANGWATCH_OPS_API_KEY`, blank-is-unconfigured. */
  opsApiKey: string | undefined;
  /** Whether this deployment is production, for the app's fail-closed rule. */
  isProduction: boolean;
}): ApiOpsExplainRest | undefined {
  const url = options.opsClickHouseUrl?.trim();
  const apiKey = options.opsApiKey?.trim();
  if (!url || !apiKey) return undefined;

  const runtime = OpsClickHouseRuntime.create({ url, buildTime: false });
  const clients = new ApiOpsExplainClients(runtime);
  // Composed so `installApiOps` has a decision service to wire, though the
  // ONLY consumer of it is the operator application's own explain method.
  OpsExplainService.create({ repository: OpsExplainClickHouseRepository.create({ resolver: clients }) });

  return { clients, opsApiKey: apiKey, isProduction: options.isProduction, close: () => runtime.close() };
}

/** Mounts `/api/ops/clickhouse/explain` over the operator application. */
export function mountOpsClickHouseExplainRest(
  runtime: ApiRestRuntime,
  ports: OpsClickHouseExplainRestPorts,
): MountableRestApp {
  return runtime.mount(opsClickHouseExplainRest.router(), ports.ops);
}

/**
 * The dedicated account, and never a fallback.
 */
class ApiOpsExplainClients implements OpsExplainClients {
  constructor(private readonly runtime: OpsClickHouseRuntime) {}

  findClient(): OpsExplainClientResolution | null {
    const client = this.runtime.resolveClient();

    return client ? { client, usingFallback: false } : null;
  }
}
