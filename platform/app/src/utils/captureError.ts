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

const stacktraceFromErrorLike = (stack: unknown): string[] => {
  if (typeof stack === "string") return stack.split("\n");
  if (
    Array.isArray(stack) &&
    stack.length > 0 &&
    typeof stack[0] === "string"
  ) {
    return stack;
  }
  return ["No stack trace available"];
};

const captureErrorLike = (error: object): ErrorCapture => {
  const err = error as { message: unknown; stack: unknown };
  const message =
    typeof err.message === "string" ? err.message : "An unknown error occurred";
  return {
    has_error: true,
    message,
    stacktrace: stacktraceFromErrorLike(err.stack),
  };
};

export const captureError = (error: unknown): ErrorCapture => {
  if (error instanceof Error) {
    return {
      has_error: true,
      message: error.message,
      stacktrace: error.stack ? error.stack.split("\n") : [],
    };
  } else if (typeof error === "object" && error !== null) {
    return captureErrorLike(error);
  } else {
    // Handle primitives and other types that are not an error object
    return {
      has_error: true,
      message: String(error),
      stacktrace: [],
    };
  }
};
