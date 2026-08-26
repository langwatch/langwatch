import type { ClickHouseClient } from "@clickhouse/client";
import {
  ClickHouseRetroactiveRetentionRepository,
  type RetentionClickHouseClient,
} from "../repositories/clickhouse/clickhouse.retroactive-retention.repository";
import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository";

export type TenantClickHouseClientResolver = (
  tenantId: string,
) => Promise<ClickHouseClient>;

export class ClickHouseRetroactiveRetentionAdapter {
  private constructor() {}

  static create(options: {
    resolveClickHouseClient: TenantClickHouseClientResolver | null;
  }): RetroactiveRetentionRepository | null {
    const resolveClickHouseClient = options.resolveClickHouseClient;
    if (!resolveClickHouseClient) {
      return null;
    }

    return ClickHouseRetroactiveRetentionRepository.create({
      resolveClient: async (projectId) => {
        const client = await resolveClickHouseClient(projectId);
        return ClickHouseRetroactiveRetentionAdapter.adaptClient(client);
      },
    });
  }

  private static adaptClient(client: ClickHouseClient): RetentionClickHouseClient {
    return {
      async command(input): Promise<void> {
        await client.command(input);
      },
      async query(input): Promise<{ json(): Promise<unknown> }> {
        const result = await client.query(input);
        return { json: () => result.json<unknown>() };
      },
    };
  }
}
