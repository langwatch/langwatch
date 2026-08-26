import type {
  TelemetryLogPreparation,
  TelemetryLogRedactionService,
  TelemetryMetricPreparation,
  TelemetryMetricRedactionService,
} from "@langwatch/telemetry-contract";

export type TelemetryLogPreparationInput = {
  tenantId: string;
  organizationId: string;
  request: unknown;
  piiRedactionLevel: "STRICT" | "ESSENTIAL" | "DISABLED";
  redactionService: TelemetryLogRedactionService;
  acceptedAt?: number;
};

export type TelemetryMetricPreparationInput = {
  tenantId: string;
  organizationId: string;
  request: unknown;
  piiRedactionLevel: "STRICT" | "ESSENTIAL" | "DISABLED";
  redactionService: TelemetryMetricRedactionService;
  acceptedAt?: number;
};

export abstract class TelemetryLogPreparationPort {
  abstract prepare(input: TelemetryLogPreparationInput): Promise<TelemetryLogPreparation>;
}

export abstract class TelemetryMetricPreparationPort {
  abstract prepare(
    input: TelemetryMetricPreparationInput,
  ): Promise<TelemetryMetricPreparation>;
}
