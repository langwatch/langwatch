import { SimulationService } from "../services/simulation.service";
import { SimulationClickHouseRepository } from "../repositories/clickhouse/simulation.clickhouse.repository";
import { SimulationWindowedRead } from "../repositories/clickhouse/simulation-windowed-read.port";
import type { SimulationExecutionPort } from "../ports/simulation-execution.port";
import { NullSimulationRepository } from "../repositories/simulation.repository";

/** The narrow query capability Simulation needs from a routed ClickHouse client. */
export type SimulationReadClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | string[]>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
};

/**
 * Application-composition adapter for the Simulation ClickHouse read store.
 * Repositories stay private; callers receive only the canonical service.
 */
export class SimulationClickHouseAdapter {
  static create(input: {
    resolveClient: (tenantId: string) => Promise<SimulationReadClient>;
    windowedRead: SimulationWindowedRead;
    execution: SimulationExecutionPort;
  }): SimulationService {
    return new SimulationService(
      SimulationClickHouseRepository.create(
        input.resolveClient,
        input.windowedRead,
      ),
      input.execution,
    );
  }

  /** Preserve the existing empty-read behavior when ClickHouse is disabled. */
  static createNull(input: { execution: SimulationExecutionPort }): SimulationService {
    return SimulationService.create(new NullSimulationRepository(), input.execution);
  }
}
