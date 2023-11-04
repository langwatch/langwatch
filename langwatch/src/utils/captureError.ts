import type { ErrorCapture } from "../server/tracer/types";

export const captureError = (error: Error): ErrorCapture => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stacktrace: error.stack ? error.stack.split("\n") : [],
    };
  } else if (typeof error === "object" && error !== null) {
    const err = error as { message: unknown; stack: unknown };
    const message =
      typeof err.message === "string"
        ? err.message
        : "An unknown error occurred";
    const stacktrace =
      typeof err.stack === "string"
        ? err.stack.split("\n")
        : ["No stack trace available"];
    return {
      message,
      stacktrace,
    };
  } else {
    // Handle primitives and other types that are not an error object
    return {
      message: String(error),
      stacktrace: [],
    };
  }
};
