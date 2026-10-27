import pino from "pino";

import { ERROR_SUMMARY } from "../constants.ts";
import { redactCommandCredentials } from "../logger.ts";

/**
 * A failure cut to type, message, code and stack, so a wide error stays under Loki's 128
 * structured-metadata keys (#8483). Credentials stay masked, other objects are described by
 * key count only, and it never throws (specs/observability/request-log-cause-and-level.feature).
 */
export function summarizeError(error: unknown): ErrorSummary {
  try {
    return brand(summarizeUnsafe(error));
  } catch {
    return brand({ type: "unknown", message: UNSERIALIZABLE_MESSAGE });
  }
}

type ErrorSummary = {
  type: string;
  message: string;
  code?: string | number;
  stack?: string;
};

export const MAX_SUMMARY_MESSAGE_LENGTH = 1000;
export const MAX_SUMMARY_STACK_LENGTH = 8000;
const UNSERIALIZABLE_MESSAGE = "Unserializable thrown value";
const TRUNCATION_MARKER = "… [truncated]";

/** Marks a summary so the logger serializer recognises it; never enumerable. */
function brand(summary: ErrorSummary): ErrorSummary {
  return Object.defineProperty(summary, ERROR_SUMMARY, { value: true });
}

function summarizeUnsafe(error: unknown): ErrorSummary {
  if (typeof error === "string") {
    return { type: "string", message: truncate(error, MAX_SUMMARY_MESSAGE_LENGTH) };
  }

  if (!(error instanceof Error)) {
    return isErrorLike(error) ? summarizeErrorLike(error) : describeOpaqueValue(error);
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
    ...(stack === undefined ? {} : { stack: truncate(stack, MAX_SUMMARY_STACK_LENGTH) }),
  };
}

/** An error-shaped object that is not an `Error`: its text survives, credentials masked. */
function summarizeErrorLike(
  error: Parameters<typeof redactCommandCredentials>[0] & {
    message: string;
    name?: unknown;
    code?: unknown;
    stack?: unknown;
  },
): ErrorSummary {
  const { name, message, code, stack } = redactCommandCredentials(error);
  return {
    type: typeof name === "string" && name ? name : "Object",
    message: truncate(message, MAX_SUMMARY_MESSAGE_LENGTH),
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(typeof stack === "string" ? { stack: truncate(stack, MAX_SUMMARY_STACK_LENGTH) } : {}),
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
