import { type Context, type Tracer } from "@opentelemetry/api";

import type { AddEvaluationParams } from "../evaluation";
import type { LangWatchSpan, LangWatchSpanOptions } from "../span/types";

/**
 * Enhanced LangWatch tracer interface that extends OpenTelemetry's Tracer: returns
 * LangWatchSpan instances, and adds `withActiveSpan` for automatic span lifecycle
 * and error handling.
 */
export interface LangWatchTracer extends Tracer {
  /**
   * Starts a new LangWatchSpan without setting it as the active span.
   * @param name - The name of the span
   * @param options - Optional span configuration options
   * @param context - Optional context to use for extracting parent span information
   * @returns A new LangWatchSpan instance
   */
  startSpan(name: string, options?: LangWatchSpanOptions, context?: Context): LangWatchSpan;

  /**
   * Starts a new active LangWatchSpan and executes fn within its context. Unlike
   * `withActiveSpan`, the span is not ended automatically — call `span.end()` yourself.
   * @param name - The name of the span
   * @param fn - Function to execute with the active span
   * @returns The return value of the provided function
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(name: string, fn: F): ReturnType<F>;

  /**
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param fn - Function to execute with the active span
   * @returns The return value of the provided function
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    fn: F,
  ): ReturnType<F>;

  /**
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param context - Context to use for extracting parent span information
   * @param fn - Function to execute with the active span
   * @returns The return value of the provided function
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;

  /**
   * LangWatch enhancement: creates and manages a span with automatic lifecycle and error
   * handling — the span ends and any thrown error is recorded automatically, so no manual
   * `span.end()` or try/catch is needed, unlike OpenTelemetry's `startActiveSpan`.
   * @param name - The name of the span
   * @param fn - Function to execute with the managed span (can be sync or async)
   * @returns A promise that resolves to the return value of the provided function
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(name: string, fn: F): ReturnType<F>;

  /**
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param fn - Function to execute with the managed span (can be sync or async)
   * @returns A promise that resolves to the return value of the provided function
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    fn: F,
  ): ReturnType<F>;

  /**
   * @param name - The name of the span
   * @param options - Span configuration options
   * @param context - Context to use for extracting parent span information
   * @param fn - Function to execute with the managed span (can be sync or async)
   * @returns A promise that resolves to the return value of the provided function
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    options: LangWatchSpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;

  /**
   * A no-op if no span is active.
   * @param params - Evaluation parameters; only `name` is required, see
   *   {@link AddEvaluationParams}. `status` defaults to `"processed"`.
   */
  addEvaluation(params: AddEvaluationParams): void;
}
