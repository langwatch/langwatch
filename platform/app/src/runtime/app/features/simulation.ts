import type { SimulationService } from "@langwatch/simulation-contract";
import {
  SimulationClickHouseAdapter,
  SimulationExecutionPort,
  SimulationWindowedRead,
  type SimulationReadClient,
  type SimulationWindowedReadInput,
} from "@langwatch/simulation-server";
import type { AppCommands } from "~/server/event-sourcing/registration/pipelineRegistry";
import { queryWindowed } from "~/server/app-layer/clients/clickhouse/windowed-read";

type SimulationCommands = Pick<
  AppCommands["simulations"],
  | "queueRun"
  | "startRun"
  | "messageSnapshot"
  | "textMessageStart"
  | "textMessageEnd"
  | "finishRun"
  | "cancelRun"
  | "deleteRun"
>;

/** Binds the canonical Simulation service to the registered Eventing commands. */
export class AppSimulationExecutionPort extends SimulationExecutionPort {
  static create(commands: SimulationCommands): AppSimulationExecutionPort {
    return new AppSimulationExecutionPort(commands);
  }

  private constructor(private readonly commands: SimulationCommands) {
    super();
  }

  queueRun(input: Parameters<SimulationExecutionPort["queueRun"]>[0]) {
    return this.commands.queueRun(input);
  }

  startRun(input: Parameters<SimulationExecutionPort["startRun"]>[0]) {
    return this.commands.startRun(input);
  }

  messageSnapshot(
    input: Parameters<SimulationExecutionPort["messageSnapshot"]>[0],
  ) {
    return this.commands.messageSnapshot(input);
  }

  textMessageStart(
    input: Parameters<SimulationExecutionPort["textMessageStart"]>[0],
  ) {
    return this.commands.textMessageStart(input);
  }

  textMessageEnd(
    input: Parameters<SimulationExecutionPort["textMessageEnd"]>[0],
  ) {
    return this.commands.textMessageEnd(input);
  }

  finishRun(input: Parameters<SimulationExecutionPort["finishRun"]>[0]) {
    return this.commands.finishRun(input);
  }

  cancelRun(input: Parameters<SimulationExecutionPort["cancelRun"]>[0]) {
    return this.commands.cancelRun(input);
  }

  deleteRun(input: Parameters<SimulationExecutionPort["deleteRun"]>[0]) {
    return this.commands.deleteRun(input);
  }
}

/** Reuses the process-wide ClickHouse windowing policy and its telemetry. */
export class AppSimulationWindowedRead extends SimulationWindowedRead {
  query<Result>(input: SimulationWindowedReadInput<Result>): Promise<Result> {
    return queryWindowed(input);
  }
}

export type AppSimulationRuntimeOptions = {
  clickhouseEnabled: boolean;
  resolveClient: (projectId: string) => Promise<SimulationReadClient>;
  commands: SimulationCommands;
};

/** Creates the process's single canonical Simulation service. */
export class AppSimulationRuntime {
  static create(options: AppSimulationRuntimeOptions): AppSimulationRuntime {
    return new AppSimulationRuntime(options);
  }

  private constructor(private readonly options: AppSimulationRuntimeOptions) {}

  build(): SimulationService {
    const execution = AppSimulationExecutionPort.create(this.options.commands);
    if (!this.options.clickhouseEnabled) {
      return SimulationClickHouseAdapter.createNull({ execution });
    }
    return SimulationClickHouseAdapter.create({
      resolveClient: this.options.resolveClient,
      windowedRead: new AppSimulationWindowedRead(),
      execution,
    });
  }
}
