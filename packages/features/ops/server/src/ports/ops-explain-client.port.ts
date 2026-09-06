import type { ClickHouseClient } from "@clickhouse/client";

export interface OpsExplainClientResolution {
  client: ClickHouseClient;
  /** True when the dedicated `langwatch_ops` readonly user is not
   *  configured on this instance and the call fell back to the
   *  default-user shared client. */
  usingFallback: boolean;
}

/** Complete composition port for selecting the dedicated or shared client. */
export abstract class OpsExplainClientPort {
  abstract tryResolve(): OpsExplainClientResolution | null;
}
