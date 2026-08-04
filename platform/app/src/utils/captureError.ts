import type { ErrorCapture } from "../server/tracer/types";

/**
 * Extracts an error message from an unknown error value.
 * Handles Error instances, objects with message property, and primitives.
 */
export function extractErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export const captureError = (error: unknown): ErrorCapture => {
  if (error instanceof Error) {
    return {
      has_error: true,
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
        : Array.isArray(err.stack) &&
            err.stack.length > 0 &&
            typeof err.stack[0] === "string"
          ? err.stack
          : ["No stack trace available"];
    return {
      has_error: true,
      message,
      stacktrace,
    };
  } else {
    // Handle primitives and other types that are not an error object
    return {
      has_error: true,
      message: String(error),
      stacktrace: [],
    };
  }
};
