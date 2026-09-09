import type { LogRecordReceivedEventData } from "@langwatch/trace-contract";

/** The headline input and output a log record carries, before any clamping. */
export type LogTraceIo = { input: string | null; output: string | null };

/**
 * Reading a conversation out of a log record, and deciding how much of it is
 * worth duplicating onto a trace, are both Trace's rules. Log takes them as a
 * port the application composes rather than reaching into Trace's server.
 */
export abstract class LogTraceIoPort {
  abstract extractIo(data: LogRecordReceivedEventData): LogTraceIo;
  abstract preview(value: string): string;
}
