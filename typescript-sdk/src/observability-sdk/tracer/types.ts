import {
  Context,
  Tracer,
} from "@opentelemetry/api";
import type { LangWatchSpan, LangWatchSpanOptions } from "../span/types";

/**
 * Enhanced LangWatch tracer interface that extends OpenTelemetry's Tracer.
 *
 * This tracer provides additional functionality beyond the standard OpenTelemetry tracer:
 * - Returns LangWatchSpan instances instead of standard OpenTelemetry Spans
 * - Includes a custom `withActiveSpan` method for simplified span lifecycle management
 * - Automatic error handling and span status management in `withActiveSpan`
 * - Enhanced type safety with strongly-typed callback functions
 *
 * @example Basic usage
 * ```typescript
 * const tracer = getLangWatchTracer('my-service', '1.0.0');
 *
 * // Create and manage spans manually
 * const span = tracer.startSpan('operation');
 * span.setAttributes({ key: 'value' });
 * span.end();
 *
 * // Use active span with automatic lifecycle management
 * const result = await tracer.startActiveSpan('async-operation', async (span) => {
 *   span.setAttributes({ userId: '123' });
 *   return await someAsyncWork();
 * });
 *
 * // Use withActiveSpan for automatic error handling and span cleanup
 * const result = await tracer.withActiveSpan('safe-operation', async (span) => {
 *   // Span is automatically ended and errors are properly recorded
 *   return await riskyOperation();
 * });
 * ```
 */
export interface LangWatchTracer extends Tracer {
  /**
   * Starts a new LangWatchSpan without setting it as the active span.
   *
   * **Enhanced from OpenTelemetry**: Returns a LangWatchSpan instead of a standard Span,
   * providing additional LangWatch-specific functionality like structured input/output
   * recording and enhanced attribute management.
   *
   * @param name - The name of the span
   * @param options - Optional span configuration options
   * @param context - Optional context to use for extracting parent span information
   * @returns A new LangWatchSpan instance
   *
   * @example
   * ```typescript
   * const span = tracer.startSpan('database-query');
   * span.setAttributes({
   *   'db.statement': 'SELECT * FROM users',
   *   'db.operation': 'select'
   * });
   *
   * try {
   *   const result = await database.query('SELECT * FROM users');
   *   span.setStatus({ code: SpanStatusCode.OK });
   *   return result;
   * } catch (error) {
   *   span.setStatus({
   *     code: SpanStatusCode.ERROR,
   *     message: error.message
   *   });
   *   span.recordException(error);
   *   throw error;
   * } finally {
   *   span.end();
   * }
   * ```
   */
  startSpan(
    name: string,
    options?: LangWatchSpanOptions,
    context?: Context,
  ): LangWatchSpan;

  /**
   * Starts a new active LangWatchSpan and executes the provided function within its context.
   *
   * **Same as OpenTelemetry** but with LangWatchSpan: The span is automatically set as active
   * in the current context for the duration of the function execution. The span must be
   * manually ended within the callback function.
   *
   * @param name - The name of the span
   * @param fn - Function to execute with the active span
   * @returns The return value of the provided function
   *
   * @example
   * ```typescript
   * const result = tracer.startActiveSpan('user-operation', (span) => {
   *   span.setAttributes({ userId: '123' });
   *
   *   try {
   *     const userData = fetchUserData();
   *     span.setStatus({ code: SpanStatusCode.OK });
   *     return userData;
   *   } catch (error) {
   *     span.setStatus({
   *       code: SpanStatusCode.ERROR,
   *       message: error.message
   *     });
   *     throw error;
   *   } finally {
   *     span.end(); // Must manually end the span
   *   }
   * });
   * ```
   */
  startActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;

  /**
   * Starts a new active LangWatchSpan with options and executes the provided function.
   *
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
   * Starts a new active LangWatchSpan with options and context, then executes the function.
   *
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
   * **LangWatch Enhancement**: Creates and manages a span with **automatic lifecycle and error handling**.
   *
   * 🚀 **Automatic span management, batteries included**:
   * - ✅ **Span automatically ends** when your function completes (success or failure)
   * - ✅ **Errors automatically handled** - exceptions are caught, recorded, and span marked as ERROR
   * - ✅ **No need to call `span.end()`** - completely managed for you
   * - ✅ **No try/catch needed** - error recording is automatic
   *
   * **Key differences from OpenTelemetry's startActiveSpan**:
   * - Automatically ends the span when the function completes
   * - Automatically sets span status to ERROR and records exceptions on thrown errors
   * - Handles both synchronous and asynchronous functions seamlessly
   * - Provides a safer, more convenient API for span management
   *
   * **Perfect for**: Operations where you want zero boilerplate span management.
   * Just focus on your business logic - span lifecycle is handled automatically.
   *
   * @param name - The name of the span
   * @param fn - Function to execute with the managed span (can be sync or async)
   * @returns A promise that resolves to the return value of the provided function
   *
   * @example ✅ Clean code - NO manual span management needed
   * ```typescript
   * // ✅ AUTOMATIC span ending and error handling
   * const result = await tracer.withActiveSpan('risky-operation', async (span) => {
   *   span.setAttributes({ operation: 'data-processing' });
   *
   *   if (Math.random() > 0.5) {
   *     throw new Error('Random failure'); // ✅ Automatically recorded, span marked as ERROR
   *   }
   *
   *   return 'success';
   *   // ✅ NO span.end() needed - automatically handled!
   *   // ✅ NO try/catch needed - errors automatically recorded!
   * });
   * ```
   *
   * @example ❌ vs ✅ Compare with manual span management
   * ```typescript
   * // ❌ Manual span management (what you DON'T need to do)
   * const span = tracer.startSpan('operation');
   * try {
   *   span.setAttributes({ key: 'value' });
   *   const result = await doWork();
   *   span.setStatus({ code: SpanStatusCode.OK });
   *   return result;
   * } catch (error) {
   *   span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
   *   span.recordException(error);
   *   throw error;
   * } finally {
   *   span.end(); // Must remember to end!
   * }
   *
   * // ✅ With withActiveSpan (clean and automatic)
   * const result = await tracer.withActiveSpan('operation', async (span) => {
   *   span.setAttributes({ key: 'value' });
   *   return await doWork(); // That's it! Everything else is automatic
   * });
   * ```
   *
   * @example ✅ Synchronous operations (no async/await needed)
   * ```typescript
   * const result = await tracer.withActiveSpan('sync-calc', (span) => {
   *   span.setAttributes({ calculation: 'fibonacci' });
   *   return fibonacci(10); // ✅ Synchronous function - span ends automatically
   * });
   *
   * // ✅ Even with operations that might throw
   * const data = await tracer.withActiveSpan('read-config', (span) => {
   *   span.setAttributes({ file: 'config.json' });
   *   return JSON.parse(fs.readFileSync('config.json', 'utf8')); // ✅ Errors auto-handled
   * });
   * ```
   */
  withActiveSpan<F extends (span: LangWatchSpan) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;

  /**
   * Creates and manages a span with options and automatic lifecycle management.
   *
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
   * Creates and manages a span with options, context, and automatic lifecycle management.
   *
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
}
