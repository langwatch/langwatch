/**
 * The number of logs submitted to enabled SDK Loggers.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export declare const METRIC_OTEL_SDK_LOG_CREATED: "otel.sdk.log.created";
/**
 * The number of log records for which the processing has finished, either successful or failed.
 *
 * @note For successful processing, `error.type` **MUST NOT** be set. For failed processing, `error.type` **MUST** contain the failure cause.
 * For the SDK Simple and Batching Log Record Processor a log record is considered to be processed already when it has been submitted to the exporter,
 * not when the corresponding export call has finished.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export declare const METRIC_OTEL_SDK_PROCESSOR_LOG_PROCESSED: "otel.sdk.processor.log.processed";
/**
 * The maximum number of log records the queue of a given instance of an SDK Log Record processor can hold.
 *
 * @note Only applies to Log Record processors which use a queue, e.g. the SDK Batching Log Record Processor.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export declare const METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_CAPACITY: "otel.sdk.processor.log.queue.capacity";
/**
 * The number of log records in the queue of a given instance of an SDK log processor.
 *
 * @note Only applies to log record processors which use a queue, e.g. the SDK Batching Log Record Processor.
 *
 * @experimental This metric is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export declare const METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_SIZE: "otel.sdk.processor.log.queue.size";
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
export declare const ATTR_OTEL_COMPONENT_NAME: "otel.component.name";
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
export declare const ATTR_OTEL_COMPONENT_TYPE: "otel.component.type";
/**
 * Enum value "batching_log_processor" for attribute {@link ATTR_OTEL_COMPONENT_TYPE}.
 *
 * The builtin SDK batching log record processor
 *
 * @experimental This enum value is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export declare const OTEL_COMPONENT_TYPE_VALUE_BATCHING_LOG_PROCESSOR: "batching_log_processor";
/**
 * Enum value "simple_log_processor" for attribute {@link ATTR_OTEL_COMPONENT_TYPE}.
 *
 * The builtin SDK simple log record processor
 *
 * @experimental This enum value is experimental and is subject to breaking changes in minor releases of `@opentelemetry/semantic-conventions`.
 */
export declare const OTEL_COMPONENT_TYPE_VALUE_SIMPLE_LOG_PROCESSOR: "simple_log_processor";
/**
 * Describes a class of error the operation ended with.
 *
 * @example timeout
 * @example java.net.UnknownHostException
 * @example server_certificate_invalid
 * @example 500
 *
 * @note The `error.type` **SHOULD** be predictable, and **SHOULD** have low cardinality.
 *
 * When `error.type` is set to a type (e.g., an exception type), its
 * canonical class name identifying the type within the artifact **SHOULD** be used.
 *
 * Instrumentations **SHOULD** document the list of errors they report.
 *
 * The cardinality of `error.type` within one instrumentation library **SHOULD** be low.
 * Telemetry consumers that aggregate data from multiple instrumentation libraries and applications
 * should be prepared for `error.type` to have high cardinality at query time when no
 * additional filters are applied.
 *
 * If the operation has completed successfully, instrumentations **SHOULD NOT** set `error.type`.
 *
 * If a specific domain defines its own set of error identifiers (such as HTTP or RPC status codes),
 * it's **RECOMMENDED** to:
 *
 *   - Use a domain-specific attribute
 *   - Set `error.type` to capture all errors, regardless of whether they are defined within the domain-specific set or not.
 */
export declare const ATTR_ERROR_TYPE: "error.type";
//# sourceMappingURL=semconv.d.ts.map