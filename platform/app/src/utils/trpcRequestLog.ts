import type { loggerLink } from "@trpc/client";

type LoggerOptions = NonNullable<Parameters<typeof loggerLink>[0]>;
type LogEntry = Parameters<NonNullable<LoggerOptions["logger"]>>[0];

/** Names the operation and its timing only: inputs and results can carry secrets. */
export function logTrpcOperation(entry: LogEntry): void {
  if (entry.direction === "up") {
    console.log(`>> ${entry.type} ${entry.path}`);
    return;
  }
  const log = entry.result instanceof Error ? console.error : console.log;
  log(`<< ${entry.type} ${entry.path} ${Math.round(entry.elapsedMs)}ms`);
}
