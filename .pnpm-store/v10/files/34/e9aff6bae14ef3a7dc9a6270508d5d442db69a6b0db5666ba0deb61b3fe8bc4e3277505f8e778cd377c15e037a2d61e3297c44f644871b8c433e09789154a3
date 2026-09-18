/**
 * Outcome of a request, recorded by the framework via {@link MetricsRecorder.recordRequestOutcome}.
 *
 * @public
 */
export type RequestOutcome = "Success" | "Fault";
/**
 * Unit attached to a recorded metric value. The vocabulary follows the
 * CloudWatch unit names so backends that emit to CloudWatch can pass it
 * through, but it carries no backend-specific semantics — a recorder is free
 * to map or ignore it.
 *
 * @public
 */
export type MetricUnit = "Seconds" | "Microseconds" | "Milliseconds" | "Bytes" | "Kilobytes" | "Megabytes" | "Gigabytes" | "Terabytes" | "Bits" | "Kilobits" | "Megabits" | "Gigabits" | "Terabits" | "Percent" | "Count" | "None" | "Bytes/Second" | "Kilobytes/Second" | "Megabytes/Second" | "Gigabytes/Second" | "Terabytes/Second" | "Bits/Second" | "Kilobits/Second" | "Megabits/Second" | "Gigabits/Second" | "Terabits/Second" | "Count/Second";
/**
 * Backend-agnostic recorder for per-request metrics. The framework drives the
 * lifecycle and records request-level metrics through this interface; user
 * handlers record their own business metrics through the same methods. Concrete
 * recorders (e.g. an EMF recorder, or a future OpenTelemetry recorder) translate
 * these abstract calls into their own primitives.
 *
 * @typeParam Native - the concrete backend handle returned by
 *   {@link MetricsRecorder.getMetrics}, e.g. an OpenTelemetry `Meter`. The
 *   parameter is required so that native access is always typed rather than
 *   erased to `unknown`.
 *
 * @public
 */
export interface MetricsRecorder<Native> {
    /**
     * Open the recorder for the current request. Called by the framework once at
     * the start of request handling.
     */
    begin(): void;
    /**
     * Close the recorder for the current request. Called by the framework once at
     * the end of request handling; this is where an implementation typically
     * flushes its event.
     */
    end(): void;
    /**
     * Records the outcome and duration of a request. The concrete backend decides
     * how to express this.
     */
    recordRequestOutcome(outcome: RequestOutcome, durationMs: number): void;
    /**
     * Records a count. Values should be non-negative for cross-backend portability.
     */
    addCount(name: string, value: number): void;
    /**
     * Records a duration in milliseconds.
     */
    addTime(name: string, value: number): void;
    /**
     * Records a level — a sampled value that should average meaningfully across
     * calls (e.g. queue depth, batch size).
     */
    addLevel(name: string, value: number, unit?: MetricUnit): void;
    /**
     * Records a discrete data point where percentiles matter (e.g. per-call
     * latency, item size).
     */
    addMetric(name: string, value: number, unit?: MetricUnit): void;
    /**
     * Records a unitless ratio (e.g. cache hit rate, throttle rate).
     */
    addRatio(name: string, value: number): void;
    /**
     * Attaches a property to the request's metrics. A nullish or empty value
     * removes the property.
     */
    setProperty(name: string, value: string | null | undefined): void;
    /**
     * Returns the recorder's native backend handle, so callers can reach
     * library-specific features the abstract methods do not expose (e.g. an
     * OpenTelemetry `Meter`).
     */
    getMetrics(): Native;
}
/**
 * Creates a per-request {@link MetricsRecorder}. Created once at startup and
 * passed to the service handler; the framework calls {@link MetricsRecorderFactory.create}
 * once per request to obtain a scoped recorder.
 *
 * @typeParam Native - the native backend handle exposed by recorders this
 *   factory produces. See {@link MetricsRecorder}.
 *
 * @public
 */
export interface MetricsRecorderFactory<Native> {
    create(): MetricsRecorder<Native>;
}
