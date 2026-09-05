/**
 * This process's composition of the operator-only ClickHouse EXPLAIN endpoint
 * (`@langwatch/ops-server`).
 */
import {
  OpsClickHouseRuntime,
  OpsExplainClickHouseRepository,
  OpsExplainClientResolver,
  OpsExplainService,
  type OpsExplainClientResolution,
  type OpsClickHouseExplainRestPorts,
} from "@langwatch/ops-server";

/** The family's collaborators and the connection they hold, or nothing. */
export type ApiOpsExplainRest = Readonly<{
  ports: OpsClickHouseExplainRestPorts;
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
  const service = OpsExplainService.create({
    repository: OpsExplainClickHouseRepository.create({
      resolver: new ApiOpsExplainClientResolver(runtime),
    }),
  });

  return {
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
class ApiOpsExplainClientResolver extends OpsExplainClientResolver {
  constructor(private readonly runtime: OpsClickHouseRuntime) {
    super();
  }

  resolve(): OpsExplainClientResolution | null {
    const client = this.runtime.resolveClient();
    return client ? { client, usingFallback: false } : null;
  }
}
