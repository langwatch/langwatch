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

export interface LogRedaction {
  redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    piiRedactionLevel: LogPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}
