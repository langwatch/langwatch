import pino from "pino";
import { redactCommandCredentials } from "../logger";

/**
 * A failure reduced to the four fields worth reading.
 *
 * Loki accepts at most 128 structured-metadata keys per record, and every
 * nested key of a logged error becomes one: a ZodError's `issues` or a Prisma
 * error's `meta` pushed request records past 250 keys, and Loki dropped them
 * whole (#8483). Type, message, code and stack are what a failure is triaged
 * by, and they stay a fixed four keys however wide the error is.
 *
 * Credential masking survives because an `Error` summary is cut from the
 * already-redacted pino serialization. That serialization folds the messages
 * of nested `cause`s into `message` and their stacks into `stack`, so inner
 * causes stay readable. Other fields of a cause, and extras such as a
 * HandledError's `reasons` or `meta`, are dropped by design.
 *
 * Non-Error throwables are summarised too: a string and an error-like object
 * (string `message`) keep their text, while any other object is described only
 * by its key count, never its keys or contents, because either can hold a
 * secret (e.g. request headers). Message and stack are length-capped on every
 * path, and the function never throws.
 */
export function summarizeError(error: unknown): ErrorSummary {
  try {
    return summarizeUnsafe(error);
  } catch {
    return { type: "unknown", message: UNSERIALIZABLE_MESSAGE };
  }
}

type ErrorSummary = {
  type: string;
  message: string;
  code?: string | number;
  stack?: string;
};

const MAX_SUMMARY_MESSAGE_LENGTH = 1000;
const MAX_SUMMARY_STACK_LENGTH = 8000;
const UNSERIALIZABLE_MESSAGE = "Unserializable thrown value";
const TRUNCATION_MARKER = "… [truncated]";

function summarizeUnsafe(error: unknown): ErrorSummary {
  if (typeof error === "string") {
    return { type: "string", message: truncate(error, MAX_SUMMARY_MESSAGE_LENGTH) };
  }

  if (!(error instanceof Error)) {
    if (isErrorLike(error)) {
      const { name, message, code, stack } = error;
      return {
        type: typeof name === "string" && name ? name : "Object",
        message: truncate(message, MAX_SUMMARY_MESSAGE_LENGTH),
        ...(typeof code === "string" || typeof code === "number"
          ? { code }
          : {}),
        ...(typeof stack === "string"
          ? { stack: truncate(stack, MAX_SUMMARY_STACK_LENGTH) }
          : {}),
      };
    }
    return describeOpaqueValue(error);
  }

  const serialized = redactCommandCredentials(pino.stdSerializers.err(error));
  const { message, stack } = serialized;
  // A subclass that only sets `name` would otherwise group as "Error".
  const type =
    typeof error.name === "string" && error.name && error.name !== "Error"
      ? error.name
      : serialized.type;
  const code = (error as { code?: unknown }).code;
  return {
    type,
    message: truncate(message, MAX_SUMMARY_MESSAGE_LENGTH),
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(stack === undefined
      ? {}
      : { stack: truncate(stack, MAX_SUMMARY_STACK_LENGTH) }),
  };
}

/** Cuts to `max` characters in total, marker included, so a cut is visible. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function isErrorLike(value: unknown): value is {
  message: string;
  name?: unknown;
  code?: unknown;
  stack?: unknown;
} {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/** Describes a non-error value without ever reading its keys or contents. */
function describeOpaqueValue(value: unknown): ErrorSummary {
  if (value !== null && typeof value === "object") {
    return {
      type: "Object",
      message: `Non-error object thrown (${Object.keys(value).length} keys)`,
    };
  }
  return {
    type: typeof value,
    message: truncate(String(value), MAX_SUMMARY_MESSAGE_LENGTH),
  };
}
