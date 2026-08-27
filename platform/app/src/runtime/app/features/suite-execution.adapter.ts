import type { QueueRunCommandData } from "@langwatch/simulation-server";
import {
  SuiteRunCommandsPort,
  SuiteRunIdPort,
  type QueueSimulationRunCommandData,
  type StartSuiteRunCommandData,
} from "@langwatch/suite-server";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Application composition for recording a validated Suite run through the
 * existing event-sourced scheduler. Scenario owns parameter resolution and
 * encryption; this adapter only maps its result onto durable commands.
 */
export class AppSuiteRunCommandsPort extends SuiteRunCommandsPort {
  static create(options: {
    startSuiteRun: (data: StartSuiteRunCommandData) => Promise<void>;
    queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
  }): AppSuiteRunCommandsPort {
    return new AppSuiteRunCommandsPort(options.startSuiteRun, options.queueSimulationRun);
  }

  private constructor(
    private readonly startSuiteRunCommand: (data: StartSuiteRunCommandData) => Promise<void>,
    private readonly queueSimulationRunCommand: (data: QueueRunCommandData) => Promise<void>,
  ) {
    super();
  }

  startSuiteRun(data: StartSuiteRunCommandData): Promise<void> {
    return this.startSuiteRunCommand(data);
  }

  queueSimulationRun(data: QueueSimulationRunCommandData): Promise<void> {
    return this.queueSimulationRunCommand(data);
  }
}

export class AppSuiteRunIdPort extends SuiteRunIdPort {
  next(): string {
    return generate(KSUID_RESOURCES.SCENARIO_RUN).toString();
  }
}
