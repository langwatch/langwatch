import {
  ExperimentClickHousePort,
  type ExperimentEventingClickHouseClient,
} from "../ports/experiment-clickhouse.port";

/** How the application hands the feature a tenant-scoped ClickHouse client. */
export type ExperimentEventingClickHouseResolver = (
  tenantId: string,
) => Promise<ExperimentEventingClickHouseClient>;

/** Binds the port to the application's tenant-scoped client resolver. */
export class ExperimentClickHouseAdapter extends ExperimentClickHousePort {
  private constructor(private readonly resolver: ExperimentEventingClickHouseResolver) {
    super();
  }

  static create(resolver: ExperimentEventingClickHouseResolver): ExperimentClickHouseAdapter {
    return new ExperimentClickHouseAdapter(resolver);
  }

  async resolveClient(tenantId: string): Promise<ExperimentEventingClickHouseClient> {
    return this.resolver(tenantId);
  }
}
