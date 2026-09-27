import {
  type Span,
  type SpanOptions,
  type Context,
  type Exception,
  SpanStatusCode,
  type TracerProvider,
  trace,
} from "@opentelemetry/api";

import { emitEvaluationEvent, type AddEvaluationParams } from "../evaluation";
import { createLangWatchSpan, type LangWatchSpan } from "../span";
import { type LangWatchTracer } from "./types";

/**
 * @param name - Tracer name (service or library)
 * @param version - Optional version identifier
 * @returns A LangWatch tracer with enhanced functionality
 */
export function getLangWatchTracer(name: string, version?: string): LangWatchTracer {
  return getLangWatchTracerFromProvider(trace.getTracerProvider(), name, version);
}

/**
 * @param tracerProvider - The OpenTelemetry tracer provider to use
 * @param name - Tracer name (service or library)
 * @param version - Optional version identifier
 * @returns A LangWatch tracer with enhanced functionality
 */
export function getLangWatchTracerFromProvider(
  tracerProvider: TracerProvider,
  name: string,
  version?: string,
): LangWatchTracer {
  const tracer = tracerProvider.getTracer(name, version);

  const handler: ProxyHandler<LangWatchTracer> = {
    get(target, prop) {
      switch (prop) {
        case "startActiveSpan":
          return startActiveSpanOf(target);

        case "withActiveSpan":
          return withActiveSpanOf(target);

        case "startSpan":
          return (name: string, options?: SpanOptions, context?: Context) =>
            createLangWatchSpan(target.startSpan(name, withDefaultOrigin(options), context));

        case "addEvaluation":
          return (params: AddEvaluationParams) => {
            const activeSpan = trace.getActiveSpan();
            if (!activeSpan) return;
            emitEvaluationEvent(activeSpan, params);
          };

        default: {
          const value = Reflect.get(target, prop);

          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  };

  return new Proxy(tracer, handler) as LangWatchTracer;
}

type SpanCallback = (span: LangWatchSpan, ...args: unknown[]) => unknown;

type SpanArgs =
  | [name: string, fn: SpanCallback]
  | [name: string, options: SpanOptions | undefined, fn: SpanCallback]
  | [name: string, options: SpanOptions | undefined, context: Context, fn: SpanCallback];

function hasContextArg(
  args: readonly unknown[],
): args is [string, SpanOptions | undefined, Context, SpanCallback] {
  return typeof args[3] === "function";
}

function hasOptionsArg(
  args: readonly unknown[],
): args is [string, SpanOptions | undefined, SpanCallback] {
  return typeof args[2] === "function";
}

function hasCallbackArg(args: readonly unknown[]): args is [string, SpanCallback] {
  return typeof args[1] === "function";
}

/**
 * Normalizes the variable-arg overloads of a span method: (name, fn),
 * (name, options, fn), or (name, options, context, fn). Throws if no
 * callback is found.
 */
function normalizeSpanArgs(args: SpanArgs): {
  name: string;
  options?: SpanOptions;
  context?: Context;
  fn: SpanCallback;
} {
  if (hasContextArg(args)) {
    const [name, options, context, fn] = args;
    return { name, options, context, fn };
  }
  if (hasOptionsArg(args)) {
    const [name, options, fn] = args;
    return { name, options, fn };
  }
  if (hasCallbackArg(args)) {
    const [name, fn] = args;
    return { name, fn };
  }

  throw new Error("Expected a span callback as the last argument");
}

/**
 * Injects `langwatch.origin = "application"` into span options unless the
 * caller already set one -- so experiments (`"evaluation"`) aren't overridden.
 */
function withDefaultOrigin(options?: SpanOptions): SpanOptions {
  const existing = options?.attributes?.["langwatch.origin"];
  if (existing) return options ?? {};

  return {
    ...options,
    attributes: {
      ...options?.attributes,
      "langwatch.origin": "application",
    },
  };
}

/** `startActiveSpan` with the callback handed a LangWatch span. */
function startActiveSpanOf(target: LangWatchTracer) {
  return (...args: SpanArgs) => {
    const spanArgs = normalizeSpanArgs(args);
    const options = withDefaultOrigin(spanArgs.options);

    const wrappedFn = (span: Span, ...cbArgs: unknown[]) =>
      spanArgs.fn(createLangWatchSpan(span), ...cbArgs);

    if (spanArgs.context !== void 0)
      return target.startActiveSpan(spanArgs.name, options, spanArgs.context, wrappedFn);

    return target.startActiveSpan(spanArgs.name, options, wrappedFn);
  };
}

/** `withActiveSpan` through the target's own `startActiveSpan`, to avoid double-wrapping. */
function withActiveSpanOf(target: LangWatchTracer) {
  return (...args: SpanArgs) => {
    const spanArgs = normalizeSpanArgs(args);
    const optionsWithOrigin = withDefaultOrigin(spanArgs.options);

    const cb = (span: Span) => runInLangWatchSpan(span, spanArgs.fn);

    // Call target.startActiveSpan to avoid double-wrapping
    if (spanArgs.context !== void 0)
      return target.startActiveSpan(spanArgs.name, optionsWithOrigin, spanArgs.context, cb);

    return target.startActiveSpan(spanArgs.name, optionsWithOrigin, cb);
  };
}

/** Runs `fn` in a LangWatch span, setting its status and ending it, sync or async. */
function runInLangWatchSpan(span: Span, fn: SpanCallback) {
  const wrappedSpan = createLangWatchSpan(span);

  try {
    const result = fn(wrappedSpan);

    // If result is a promise, handle it async
    if (isThenable(result)) {
      return result
        .then((result) => {
          wrappedSpan.setStatus({
            code: SpanStatusCode.OK,
          });
          return result;
        })
        .catch((err: unknown) => {
          markSpanFailed(wrappedSpan, err);
          throw err;
        })
        .finally(() => {
          wrappedSpan.end();
        });
    }

    // Sync result - end span and return
    wrappedSpan.setStatus({
      code: SpanStatusCode.OK,
    });
    wrappedSpan.end();
    return result;
  } catch (err) {
    markSpanFailed(wrappedSpan, err);
    wrappedSpan.end();
    throw err;
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function isRecordableException(value: unknown): value is Exception {
  return (
    typeof value === "string" ||
    ((typeof value === "object" || typeof value === "function") && value !== null)
  );
}

function errorMessageOf(err: unknown): string {
  const message =
    (typeof err === "object" || typeof err === "function") && err !== null && "message" in err
      ? err.message
      : undefined;
  return typeof message === "string" ? message : String(err);
}

function markSpanFailed(span: LangWatchSpan, err: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessageOf(err) });
  if (isRecordableException(err)) span.recordException?.(err);
}
