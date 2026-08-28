import type { ClickHouseCloseableClient, ClickHouseConnection } from "./connection";

/** Idempotent shutdown for the endpoints constructed by one process graph. */
export class ClickHouseShutdownService {
  private constructor() {}

  static create(): ClickHouseShutdownService {
    return new ClickHouseShutdownService();
  }

  shutdown<Client extends ClickHouseCloseableClient>(
    connection: ClickHouseConnection<Client>,
  ): Promise<void> {
    return connection.closeOnce();
  }
}
