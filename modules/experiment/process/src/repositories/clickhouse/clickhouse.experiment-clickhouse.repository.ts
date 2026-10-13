import {
  ExperimentClickHouseRepository,
  type ExperimentEventingClickHouseClient,
  type ExperimentEventingClickHouseResolver,
} from "../experiment-clickhouse.repository.ts";

/** Binds the port to the application's tenant-scoped client resolver. */
export class ClickhouseExperimentClickHouseRepository extends ExperimentClickHouseRepository {
  private constructor(private readonly resolver: ExperimentEventingClickHouseResolver) {
    super();
  }

  static create(
    resolver: ExperimentEventingClickHouseResolver,
  ): ClickhouseExperimentClickHouseRepository {
    return new ClickhouseExperimentClickHouseRepository(resolver);
  }

  async resolveClient(tenantId: string): Promise<ExperimentEventingClickHouseClient> {
    return this.resolver(tenantId);
  }
}
