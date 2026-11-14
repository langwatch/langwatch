import type { ClickHouseColumns, ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { refuseUnlessOwnTenant } from "./clickhouse.simulation-session.store.ts";
import type { SimulationClickHouseClient } from "./simulation-clickhouse.repository.ts";

/** The process's one routing `clickhouse` member, as the simulation reads send to it. */
type ScenarioReadOnlyClickHouse = Readonly<{
  columns(input: { tenantId: string }): ClickHouseColumns;
  read: ClickHouseQueryClient["read"];
}>;

/** One tenant's view of the routing member: its built reads and the columns its target holds. */
export class ClickHouseScenarioSession implements SimulationClickHouseClient {
  private constructor(
    private readonly clickhouse: ScenarioReadOnlyClickHouse,
    private readonly tenantId: string,
  ) {}

  /** Resolves each tenant's session over the one routing member. */
  static resolverOver(
    clickhouse: ScenarioReadOnlyClickHouse,
  ): (tenantId: string) => Promise<ClickHouseScenarioSession> {
    return (tenantId) => Promise.resolve(new ClickHouseScenarioSession(clickhouse, tenantId));
  }

  /** Sends a built statement only when it is this session's tenant's, else refuses by name. */
  read: ClickHouseQueryClient["read"] = async (input) => {
    refuseUnlessOwnTenant({
      statement: input.statement,
      tenantId: this.tenantId,
      operation: "ClickHouseScenarioSession.read",
    });
    return this.clickhouse.read(input);
  };

  /** Which columns of a table this tenant's target holds, for `fn.heldOr`. */
  holds({ table }: { table: string }): Promise<(name: string) => boolean> {
    return this.clickhouse.columns({ tenantId: this.tenantId }).holds({ table });
  }
}
