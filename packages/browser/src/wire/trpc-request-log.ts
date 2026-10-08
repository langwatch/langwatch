import { TRPCClientError, type loggerLink } from "@trpc/client";

type LoggerOptions = NonNullable<Parameters<typeof loggerLink>[0]>;
type LogEntry = Parameters<NonNullable<LoggerOptions["logger"]>>[0];

/**
 * Names the operation, its timing and a failure's code and status only:
 * inputs, results and error messages can carry secrets.
 */
export function logTrpcOperation(entry: LogEntry): void {
  if (entry.direction === "up") {
    console.log(`>> ${entry.type} ${entry.path}`);
    return;
  }
  const line = `<< ${entry.type} ${entry.path} ${Math.round(entry.elapsedMs)}ms`;
  const error = entry.result;
  if (!(error instanceof TRPCClientError)) {
    console.log(line);
  } else if (error.cause?.name === "AbortError") {
    // The caller cancelled (unmount, navigation, a superseded key): not a failure.
    console.log(`${line} aborted`);
  } else {
    const response = error.meta?.response;
    const status = response instanceof Response ? response.status : error.data?.httpStatus;
    console.error(`${line} ${error.data?.code ?? "no tRPC body"} ${status ?? "no response"}`);
  }
}
