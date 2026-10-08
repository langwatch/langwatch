import type { LogPiiRedactionLevel, LogPreparation } from "@langwatch/log-contract";

export type LogPreparationInput = {
  tenantId: string;
  organizationId: string;
  request: unknown;
  piiRedactionLevel: LogPiiRedactionLevel;
  acceptedAt?: number;
};

export interface LogPreparer {
  prepare(input: LogPreparationInput): Promise<LogPreparation>;
}

/** Canonical log preparation. */
export class LogService {
  private constructor(private readonly preparation: LogPreparer) {}

  static create(deps: { preparation: LogPreparer }): LogService {
    return new LogService(deps.preparation);
  }

  prepareCanonicalLogRecords(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<LogPreparation> {
    return this.preparation.prepare(input);
  }
}
