import {
  TelemetryService as TelemetryServiceContract,
  type TelemetryLogPreparation,
  type TelemetryMetricPreparation,
} from "@langwatch/telemetry-contract";
import type {
  TelemetryLogPreparationInput,
  TelemetryLogPreparationPort,
  TelemetryMetricPreparationInput,
  TelemetryMetricPreparationPort,
} from "../ports/telemetry-preparation.port";

/** Concrete process-wide implementation of the Telemetry contract. */
export class TelemetryService extends TelemetryServiceContract {
  private constructor(
    private readonly logPreparation: TelemetryLogPreparationPort,
    private readonly metricPreparation: TelemetryMetricPreparationPort,
  ) {
    super();
  }

  static create(options: {
    logPreparation: TelemetryLogPreparationPort;
    metricPreparation: TelemetryMetricPreparationPort;
  }): TelemetryService {
    return new TelemetryService(options.logPreparation, options.metricPreparation);
  }

  prepareCanonicalLogRecords(
    input: TelemetryLogPreparationInput,
  ): Promise<TelemetryLogPreparation> {
    return this.logPreparation.prepare(input);
  }

  prepareMetricDataPoints(
    input: TelemetryMetricPreparationInput,
  ): Promise<TelemetryMetricPreparation> {
    return this.metricPreparation.prepare(input);
  }
}
