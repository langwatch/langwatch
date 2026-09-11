import type { LogPiiRedactionLevel, LogPreparation } from "@langwatch/log-contract";
import type { LogRecordReceivedEventData } from "@langwatch/trace-contract";
export interface LogInfrastructure {
  logPreparation: LogPreparer;
  logRedaction: LogRedaction;
  logTraceIo: LogTraceIoExtractor;
}

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

/** The headline input and output a log record carries, before any clamping. */
export type LogTraceIo = { input: string | null; output: string | null };

/**
 * Reading a conversation out of a log record, and deciding how much of it is
 * worth duplicating onto a trace, are both Trace's rules. Log takes them as a
 * port the application composes rather than reaching into Trace's server.
 */
export interface LogTraceIoExtractor {
  extractIo(data: LogRecordReceivedEventData): LogTraceIo;
  preview(value: string): string;
}
