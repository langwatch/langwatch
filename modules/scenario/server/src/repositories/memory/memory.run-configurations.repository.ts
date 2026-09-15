import { RunConfigurationsRepository } from "../clickhouse/clickhouse.run-configurations.repository.ts";

/** The run dialog's configuration history, refused by name for the same reason. */
export class MemoryRunConfigurationsRepository extends RunConfigurationsRepository {
  findConfigurations(): ReturnType<RunConfigurationsRepository["findConfigurations"]> {
    return Promise.reject(
      new Error("Run configuration history has no ClickHouse endpoint on this deployment"),
    );
  }
}
