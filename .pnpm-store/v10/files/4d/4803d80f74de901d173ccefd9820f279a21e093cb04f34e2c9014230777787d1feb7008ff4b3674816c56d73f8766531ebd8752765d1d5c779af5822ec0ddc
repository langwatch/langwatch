/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * This file contains a copy of unstable semantic convention definitions
 * used by this package.
 * @see https://github.com/open-telemetry/opentelemetry-js/tree/main/semantic-conventions#unstable-semconv
 */
/**
 * A name uniquely identifying the instance of the OpenTelemetry component within its containing SDK instance.
 *
 * @example otlp_grpc_span_exporter/0
 * @example custom-name
 *
 * @note Implementations **SHOULD** ensure a low cardinality for this attribute, even across application or SDK restarts.
 * E.g. implementations **MUST NOT** use UUIDs as values for this attribute.
 *
 * Implementations **MAY** achieve these goals by following a `<otel.component.type>/<instance-counter>` pattern, e.g. `batching_span_processor/0`.
 * Hereby `otel.component.type` refers to the corresponding attribute value of the component.
 *
 * The value of `instance-counter` **MAY** be automatically assigned by the component and uniqueness within the enclosing SDK instance **MUST** be guaranteed.
 * For example, `<instance-counter>` **MAY** be implemented by using a monotonically increasing counter (starting with `0`), which is incremented every time an
 * instance of the given component type is started.
 *
 * With this implementation, for example the first Batching Span Processor would have `batching_span_processor/0`
 * as `otel.component.name`, the second one `batching_span_processor/1` and so on.
 * These values will therefore be reused in the case of an application restart.
 *
 * @experimental This attribute is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const ATTR_OTEL_COMPONENT_NAME = 'otel.component.name';
/**
 * A name identifying the type of the OpenTelemetry component.
 *
 * @example batching_span_processor
 * @example com.example.MySpanExporter
 *
 * @note If none of the standardized values apply, implementations **SHOULD** use the language-defined name of the type.
 * E.g. for Java the fully qualified classname **SHOULD** be used in this case.
 *
 * @experimental This attribute is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const ATTR_OTEL_COMPONENT_TYPE = 'otel.component.type';
/**
 * Determines whether the span has a parent span, and if so, [whether it is a remote parent](https://opentelemetry.io/docs/specs/otel/trace/api/#isremote)
 *
 * @experimental This attribute is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const ATTR_OTEL_SPAN_PARENT_ORIGIN = 'otel.span.parent.origin';
/**
 * The result value of the sampler for this span
 *
 * @experimental This attribute is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const ATTR_OTEL_SPAN_SAMPLING_RESULT = 'otel.span.sampling_result';
/**
 * The number of spans for which the processing has finished, either successful or failed.
 *
 * @note For successful processing, `error.type` **MUST NOT** be set. For failed processing, `error.type` **MUST** contain the failure cause.
 * For the SDK Simple and Batching Span Processor a span is considered to be processed already when it has been submitted to the exporter, not when the corresponding export call has finished.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const METRIC_OTEL_SDK_PROCESSOR_SPAN_PROCESSED = 'otel.sdk.processor.span.processed';
/**
 * The maximum number of spans the queue of a given instance of an SDK span processor can hold.
 *
 * @note Only applies to span processors which use a queue, e.g. the SDK Batching Span Processor.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_CAPACITY = 'otel.sdk.processor.span.queue.capacity';
/**
 * The number of spans in the queue of a given instance of an SDK span processor.
 *
 * @note Only applies to span processors which use a queue, e.g. the SDK Batching Span Processor.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_SIZE = 'otel.sdk.processor.span.queue.size';
/**
 * The number of created spans with `recording=true` for which the end operation has not been called yet.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const METRIC_OTEL_SDK_SPAN_LIVE = 'otel.sdk.span.live';
/**
 * The number of created spans.
 *
 * @note Implementations **MUST** record this metric for all spans, even for non-recording ones.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const METRIC_OTEL_SDK_SPAN_STARTED = 'otel.sdk.span.started';
/**
 * Enum value "batching_span_processor" for attribute {@link ATTR_OTEL_COMPONENT_TYPE}.
 *
 * The builtin SDK batching span processor
 *
 * @experimental This enum value is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const OTEL_COMPONENT_TYPE_VALUE_BATCHING_SPAN_PROCESSOR = 'batching_span_processor';
/**
 * Enum value "simple_span_processor" for attribute {@link ATTR_OTEL_COMPONENT_TYPE}.
 *
 * The builtin SDK simple span processor
 *
 * @experimental This enum value is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export const OTEL_COMPONENT_TYPE_VALUE_SIMPLE_SPAN_PROCESSOR = 'simple_span_processor';
//# sourceMappingURL=semconv.js.map