import type { LogPiiRedactionLevel, LogPreparation } from "@langwatch/log-contract";

export type LogPreparationInput = {
  tenantId: string;
  organizationId: string;
  request: unknown;
  piiRedactionLevel: LogPiiRedactionLevel;
  acceptedAt?: number;
};

export abstract class LogPreparationPort {
  abstract prepare(input: LogPreparationInput): Promise<LogPreparation>;
}
