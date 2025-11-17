/**
 * PostHog error capture utility that provides a Sentry-compatible API
 * for capturing exceptions and errors.
 */

import { getPostHogInstance } from "../server/posthog";
import posthog from "posthog-js";

interface CaptureExceptionOptions {
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  level?: "error" | "warning" | "info" | "debug";
  contexts?: Record<string, unknown>;
}

interface Scope {
  setPropagationContext?: (context: {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    propagationSpanId?: string;
    sampleRand?: number;
  }) => void;
  setTag?: (key: string, value: string) => void;
  setTags?: (tags: Record<string, string>) => void;
  setContext?: (key: string, context: Record<string, unknown>) => void;
  setExtra?: (key: string, extra: unknown) => void;
  setExtras?: (extras: Record<string, unknown>) => void;
  setLevel?: (level: "error" | "warning" | "info" | "debug") => void;
  setUser?: (user: { id?: string; email?: string; username?: string }) => void;
}

/**
 * Captures a message using PostHog (similar to Sentry.captureMessage)
 */
export function captureMessage(
  message: string,
  options?: CaptureExceptionOptions,
): void {
  const properties: Record<string, unknown> = {
    $exception_message: message,
    ...(options?.extra && { ...options.extra }),
    ...(options?.tags && { ...options.tags }),
    ...(options?.contexts && { ...options.contexts }),
  };

  const exceptionProperties = {
    ...properties,
    $exception_level: options?.level ?? "info",
  };

  // Try server-side PostHog first
  if (typeof window === "undefined") {
    const serverPostHog = getPostHogInstance();
    if (serverPostHog) {
      try {
        serverPostHog.capture({
          distinctId: "server",
          event: "$exception",
          properties: exceptionProperties,
        });
        return;
      } catch (err) {
        console.error("Failed to capture message with server PostHog:", err);
      }
    }
  }

  // Client-side PostHog
  if (typeof window !== "undefined") {
    try {
      if (posthog?.__loaded) {
        posthog.capture("$exception", exceptionProperties);
      } else {
        console.error("PostHog not initialized, logging message:", message, options);
      }
    } catch (err) {
      console.error("Failed to capture message with client PostHog:", err);
    }
  }
}

/**
 * Captures an exception/error using PostHog
 */
export function captureException(
  error: unknown,
  options?: CaptureExceptionOptions,
): void {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "Unknown error";

  const errorStack =
    error instanceof Error && error.stack ? error.stack : undefined;

  const properties: Record<string, unknown> = {
    $exception_type: error instanceof Error ? error.constructor.name : "Error",
    $exception_message: errorMessage,
    ...(errorStack && { $exception_stack_trace_raw: errorStack }),
    ...(options?.extra && { ...options.extra }),
    ...(options?.tags && { ...options.tags }),
    ...(options?.contexts && { ...options.contexts }),
  };

  const exceptionProperties = {
    ...properties,
    $exception_level: options?.level ?? "error",
  };

  // Try server-side PostHog first (for API routes, server components, etc.)
  if (typeof window === "undefined") {
    const serverPostHog = getPostHogInstance();
    if (serverPostHog) {
      try {
        serverPostHog.capture({
          distinctId: "server",
          event: "$exception",
          properties: exceptionProperties,
        });
        return;
      } catch (err) {
        console.error("Failed to capture exception with server PostHog:", err);
      }
    }
  }

  // Client-side PostHog (for browser/client components)
  if (typeof window !== "undefined") {
    try {
      if (posthog?.__loaded) {
        posthog.capture("$exception", exceptionProperties);
      } else {
        // PostHog not initialized yet, log to console
        console.error(
          "PostHog not initialized, logging error:",
          error,
          options,
        );
      }
    } catch (err) {
      console.error("Failed to capture exception with client PostHog:", err);
    }
  }
}

/**
 * Creates a scope object (no-op for PostHog, but maintains API compatibility)
 * These methods are no-ops since PostHog doesn't use scopes the same way Sentry does
 */
export function getCurrentScope(): Scope {
  return {
    setPropagationContext: () => {
      // No-op: PostHog doesn't use trace context
    },
    setTag: () => {
      // No-op: Use captureException options instead
    },
    setTags: () => {
      // No-op: Use captureException options instead
    },
    setContext: () => {
      // No-op: Use captureException options instead
    },
    setExtra: () => {
      // No-op: Use captureException options instead
    },
    setExtras: () => {
      // No-op: Use captureException options instead
    },
    setLevel: () => {
      // No-op: Use captureException options instead
    },
    setUser: () => {
      // No-op: User is handled by PostHog identify
    },
  };
}

/**
 * Executes a function within a scope (no-op for PostHog, but maintains API compatibility)
 */
export function withScope<T>(
  callback: (scope: Scope) => T | Promise<T>,
): T | Promise<T> {
  return callback(getCurrentScope());
}

/**
 * Executes a function within a span (simplified for PostHog)
 * PostHog doesn't have spans, so this just executes the callback and captures errors
 */
export async function startSpan<T>(
  options: {
    name: string;
    op?: string;
    attributes?: Record<string, unknown>;
  },
  callback: () => T | Promise<T>,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    captureException(error, {
      extra: {
        span_name: options.name,
        span_op: options.op,
        ...options.attributes,
      },
    });
    throw error;
  }
}

/**
 * Initializes PostHog (no-op, initialization is handled elsewhere)
 */
export function init(_options: unknown): void {
  // PostHog initialization is handled in usePostHog hook and server/posthog.ts
  // This is a no-op for API compatibility
}

/**
 * Default export that mimics Sentry's API structure
 */
const PostHogErrorCapture = {
  captureException,
  captureMessage,
  getCurrentScope,
  withScope,
  startSpan,
  init,
};

export default PostHogErrorCapture;
