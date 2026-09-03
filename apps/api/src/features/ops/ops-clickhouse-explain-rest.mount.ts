/**
 * This process's composition of the operator-only ClickHouse EXPLAIN endpoint
 * (`@langwatch/ops-server`).
 *
 * The endpoint is cross-tenant BY DESIGN — the optimizer agent runs EXPLAINs
 * across the fleet — and `ApiClickHouseInfrastructure` deliberately hands out
 * only a tenant-keyed `resolveClient`, with no shared one, precisely so a
 * caller cannot read one organization's data on another's endpoint. So this
 * mount does not widen that seam: it opens a SECOND, separate connection as the
 * dedicated `langwatch_ops` readonly account named by `CLICKHOUSE_OPS_URL`, and
 * where the operator provisioned no such account there is nothing to mount.
 *
 * That is a deliberate change from the retired platform router, which fell back
 * to the application's own default-user client outside production and answered
 * 503 inside it. Here an unconfigured deployment serves no endpoint at all: the
 * fallback existed so a developer could use the door without provisioning an
 * account, and the price of keeping it is a code path in which the regex filter
 * is the only thing standing between a bearer token and the whole fleet's data.
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
 * Composes the EXPLAIN endpoint, or answers nothing.
 *
 * Both conditions are structural rather than defensive. With no ops connection
 * there is no account the query may safely run as; with no operator secret
 * there is nothing to compare a bearer against, and a door whose only gate is
 * unset must not exist.
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
  const service = new OpsExplainService(
    new OpsExplainClickHouseRepository(new ApiOpsExplainClientResolver(runtime)),
  );

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
 *
 * `usingFallback` is always false here because this process composes no shared
 * client for the resolver to fall back TO — which is what makes the service's
 * production refusal unreachable rather than merely unused: the only connection
 * it can be handed is the one the deployment provisioned for it.
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
