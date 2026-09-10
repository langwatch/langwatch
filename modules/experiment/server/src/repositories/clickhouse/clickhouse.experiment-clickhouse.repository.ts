import {
  ExperimentClickHouse,
  type ExperimentEventingClickHouseClient,
} from "../../ports/experiment-clickhouse.port.ts";

/** How the application hands the feature a tenant-scoped ClickHouse client. */
export type ExperimentEventingClickHouseResolver = (
  tenantId: string,
) => Promise<ExperimentEventingClickHouseClient>;

/** Binds the port to the application's tenant-scoped client resolver. */
export class ClickhouseExperimentClickHouseRepository extends ExperimentClickHouse {
  private constructor(private readonly resolver: ExperimentEventingClickHouseResolver) {
    super();
  }

  static create(resolver: ExperimentEventingClickHouseResolver): ClickhouseExperimentClickHouseRepository {
    return new ClickhouseExperimentClickHouseRepository(resolver);
  }

  async resolveClient(tenantId: string): Promise<ExperimentEventingClickHouseClient> {
    return this.resolver(tenantId);
  }
}
