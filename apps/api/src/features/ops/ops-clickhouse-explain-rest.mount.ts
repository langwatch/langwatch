/**
 * This process's composition of the operator-only ClickHouse EXPLAIN endpoint
 * (`@langwatch/ops-server`).
 */
import {
  OpsClickHouseRuntime,
  OpsExplainClickHouseRepository,
  OpsExplainService,
  type OpsExplainClientResolution,
  type OpsExplainClients,
} from "@langwatch/ops-server";

/** What the operator-only EXPLAIN family reaches, as this process supplies it. */
export interface OpsClickHouseExplainRestPorts {
  /** The deployment's own operator secret, compared in constant time. */
  opsApiKey(): string;
  /** The decision service behind the endpoint. */
  explain(): OpsExplainService;
  /** Whether this deployment is production, for the service's fail-closed rule. */
  isProduction: boolean;
}

/** The family's collaborators and the connection they hold, or nothing. */
export type ApiOpsExplainRest = Readonly<{
  ports: OpsClickHouseExplainRestPorts;
  /** The ClickHouse account an operator EXPLAIN runs as. */
  clients: OpsExplainClients;
  /** Released with the process: the lazily-opened ops ClickHouse client. */
  close(): Promise<void>;
}>;

/**
 * Composes the EXPLAIN endpoint, or answers nothing. Both conditions are structural
 * rather than defensive.
 */
export function composeApiOpsExplainRest(options: {
  /** `CLICKHOUSE_OPS_URL`, blank-is-unconfigured. */
  opsClickHouseUrl: string | undefined;
  /** `LANGWATCH_OPS_API_KEY`, blank-is-unconfigured. */
  opsApiKey: string | undefined;
  /** Whether this deployment is production, for the service's fail-closed rule. */
  isProduction: boolean;
}): ApiOpsExplainRest | undefined {
  const url = options.opsClickHouseUrl?.trim();
  const apiKey = options.opsApiKey?.trim();
  if (!url || !apiKey) return undefined;

  const runtime = OpsClickHouseRuntime.create({ url, buildTime: false });
  const clients = new ApiOpsExplainClients(runtime);
  const service = OpsExplainService.create({
    repository: OpsExplainClickHouseRepository.create({ resolver: clients }),
  });

  return {
    clients,
    ports: {
      opsApiKey: () => apiKey,
      explain: () => service,
      isProduction: options.isProduction,
    },
    close: () => runtime.close(),
  };
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
