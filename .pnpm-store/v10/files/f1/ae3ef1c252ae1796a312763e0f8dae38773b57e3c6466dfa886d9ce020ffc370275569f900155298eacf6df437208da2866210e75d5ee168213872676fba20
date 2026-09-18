/**
 * Configure the log level of the internal logger used by the SDK.
 * Values include:
 * * debug: debug, severity number 5.
 * * debug2: debug2, severity number 6.
 * * debug3: debug3, severity number 7.
 * * debug4: debug4, severity number 8.
 * * error: error, severity number 17.
 * * error2: error2, severity number 18.
 * * error3: error3, severity number 19.
 * * error4: error4, severity number 20.
 * * fatal: fatal, severity number 21.
 * * fatal2: fatal2, severity number 22.
 * * fatal3: fatal3, severity number 23.
 * * fatal4: fatal4, severity number 24.
 * * info: info, severity number 9.
 * * info2: info2, severity number 10.
 * * info3: info3, severity number 11.
 * * info4: info4, severity number 12.
 * * trace: trace, severity number 1.
 * * trace2: trace2, severity number 2.
 * * trace3: trace3, severity number 3.
 * * trace4: trace4, severity number 4.
 * * warn: warn, severity number 13.
 * * warn2: warn2, severity number 14.
 * * warn3: warn3, severity number 15.
 * * warn4: warn4, severity number 16.
 * If omitted, INFO is used.
 */
export type SeverityNumber = ('trace' | 'trace2' | 'trace3' | 'trace4' | 'debug' | 'debug2' | 'debug3' | 'debug4' | 'info' | 'info2' | 'info3' | 'info4' | 'warn' | 'warn2' | 'warn3' | 'warn4' | 'error' | 'error2' | 'error3' | 'error4' | 'fatal' | 'fatal2' | 'fatal3' | 'fatal4') | null;
/**
 * Configure exporter to be OTLP with HTTP transport.
 * If omitted, ignore.
 */
export type OtlpHttpExporter = {
    /**
     * Configure endpoint, including the signal specific path.
     * If omitted or null, the http://localhost:4318/v1/{signal} (where signal is 'traces', 'logs', or 'metrics') is used.
     */
    endpoint?: string | null;
    tls?: HttpTls;
    /**
     * Configure headers. Entries have higher priority than entries from .headers_list.
     * If an entry's .value is null, the entry is ignored.
     * If omitted, no headers are added.
     *
     * @minItems 1
     */
    headers?: NameStringValuePair[];
    /**
     * Configure headers. Entries have lower priority than entries from .headers.
     * The value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.
     * If omitted or null, no headers are added.
     */
    headers_list?: string | null;
    /**
     * Configure compression.
     * Known values include: gzip, none. Implementations may support other compression algorithms.
     * If omitted or null, none is used.
     */
    compression?: string | null;
    /**
     * Configure max time (in milliseconds) to wait for each export.
     * Value must be non-negative. A value of 0 indicates no limit (infinity).
     * If omitted or null, 10000 is used.
     */
    timeout?: number | null;
    encoding?: OtlpHttpEncoding;
} | null;
/**
 * Configure TLS settings for the exporter.
 * If omitted, system default TLS settings are used.
 */
export type HttpTls = {
    /**
     * Configure certificate used to verify a server's TLS credentials.
     * Absolute path to certificate file in PEM format.
     * If omitted or null, system default certificate verification is used for secure connections.
     */
    ca_file?: string | null;
    /**
     * Configure mTLS private client key.
     * Absolute path to client key file in PEM format. If set, .client_certificate must also be set.
     * If omitted or null, mTLS is not used.
     */
    key_file?: string | null;
    /**
     * Configure mTLS client certificate.
     * Absolute path to client certificate file in PEM format. If set, .client_key must also be set.
     * If omitted or null, mTLS is not used.
     */
    cert_file?: string | null;
} | null;
/**
 * Configure the encoding used for messages.
 * Implementations may not support json.
 * Values include:
 * * json: Protobuf JSON encoding.
 * * protobuf: Protobuf binary encoding.
 * If omitted, protobuf is used.
 */
export type OtlpHttpEncoding = ('protobuf' | 'json') | null;
/**
 * Configure exporter to be OTLP with gRPC transport.
 * If omitted, ignore.
 */
export type OtlpGrpcExporter = {
    /**
     * Configure endpoint.
     * If omitted or null, http://localhost:4317 is used.
     */
    endpoint?: string | null;
    tls?: GrpcTls;
    /**
     * Configure headers. Entries have higher priority than entries from .headers_list.
     * If an entry's .value is null, the entry is ignored.
     * If omitted, no headers are added.
     *
     * @minItems 1
     */
    headers?: NameStringValuePair[];
    /**
     * Configure headers. Entries have lower priority than entries from .headers.
     * The value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.
     * If omitted or null, no headers are added.
     */
    headers_list?: string | null;
    /**
     * Configure compression.
     * Known values include: gzip, none. Implementations may support other compression algorithms.
     * If omitted or null, none is used.
     */
    compression?: string | null;
    /**
     * Configure max time (in milliseconds) to wait for each export.
     * Value must be non-negative. A value of 0 indicates no limit (infinity).
     * If omitted or null, 10000 is used.
     */
    timeout?: number | null;
} | null;
/**
 * Configure TLS settings for the exporter.
 * If omitted, system default TLS settings are used.
 */
export type GrpcTls = {
    /**
     * Configure certificate used to verify a server's TLS credentials.
     * Absolute path to certificate file in PEM format.
     * If omitted or null, system default certificate verification is used for secure connections.
     */
    ca_file?: string | null;
    /**
     * Configure mTLS private client key.
     * Absolute path to client key file in PEM format. If set, .client_certificate must also be set.
     * If omitted or null, mTLS is not used.
     */
    key_file?: string | null;
    /**
     * Configure mTLS client certificate.
     * Absolute path to client certificate file in PEM format. If set, .client_key must also be set.
     * If omitted or null, mTLS is not used.
     */
    cert_file?: string | null;
    /**
     * Configure client transport security for the exporter's connection.
     * Only applicable when .endpoint is provided without http or https scheme. Implementations may choose to ignore .insecure.
     * If omitted or null, false is used.
     */
    insecure?: boolean | null;
} | null;
/**
 * Configure exporter to be OTLP with file transport.
 * If omitted, ignore.
 */
export type ExperimentalOtlpFileExporter = {
    /**
     * Configure output stream.
     * Values include stdout, or scheme+destination. For example: file:///path/to/file.jsonl.
     * If omitted or null, stdout is used.
     */
    output_stream?: string | null;
} | null;
/**
 * Configure exporter to be console.
 * If omitted, ignore.
 */
export type ConsoleExporter = {} | null;
/**
 * Configure an event to span event bridge log record processor.
 * If omitted, ignore.
 */
export type ExperimentalEventToSpanEventBridgeLogRecordProcessor = {} | null;
/**
 * Configure exporter to be OTLP with HTTP transport.
 * If omitted, ignore.
 */
export type OtlpHttpMetricExporter = {
    /**
     * Configure endpoint.
     * If omitted or null, http://localhost:4318/v1/metrics is used.
     */
    endpoint?: string | null;
    tls?: HttpTls;
    /**
     * Configure headers. Entries have higher priority than entries from .headers_list.
     * If an entry's .value is null, the entry is ignored.
     * If omitted, no headers are added.
     *
     * @minItems 1
     */
    headers?: NameStringValuePair[];
    /**
     * Configure headers. Entries have lower priority than entries from .headers.
     * The value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.
     * If omitted or null, no headers are added.
     */
    headers_list?: string | null;
    /**
     * Configure compression.
     * Known values include: gzip, none. Implementations may support other compression algorithms.
     * If omitted or null, none is used.
     */
    compression?: string | null;
    /**
     * Configure max time (in milliseconds) to wait for each export.
     * Value must be non-negative. A value of 0 indicates no limit (infinity).
     * If omitted or null, 10000 is used.
     */
    timeout?: number | null;
    encoding?: OtlpHttpEncoding;
    temporality_preference?: ExporterTemporalityPreference;
    default_histogram_aggregation?: ExporterDefaultHistogramAggregation;
} | null;
/**
 * Configure temporality preference.
 * Values include:
 * * cumulative: Use cumulative aggregation temporality for all instrument types.
 * * delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.
 * * low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.
 * If omitted, cumulative is used.
 */
export type ExporterTemporalityPreference = ('cumulative' | 'delta' | 'low_memory') | null;
/**
 * Configure default histogram aggregation.
 * Values include:
 * * base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.
 * * explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.
 * If omitted, explicit_bucket_histogram is used.
 */
export type ExporterDefaultHistogramAggregation = ('explicit_bucket_histogram' | 'base2_exponential_bucket_histogram') | null;
/**
 * Configure exporter to be OTLP with gRPC transport.
 * If omitted, ignore.
 */
export type OtlpGrpcMetricExporter = {
    /**
     * Configure endpoint.
     * If omitted or null, http://localhost:4317 is used.
     */
    endpoint?: string | null;
    tls?: GrpcTls;
    /**
     * Configure headers. Entries have higher priority than entries from .headers_list.
     * If an entry's .value is null, the entry is ignored.
     * If omitted, no headers are added.
     *
     * @minItems 1
     */
    headers?: NameStringValuePair[];
    /**
     * Configure headers. Entries have lower priority than entries from .headers.
     * The value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.
     * If omitted or null, no headers are added.
     */
    headers_list?: string | null;
    /**
     * Configure compression.
     * Known values include: gzip, none. Implementations may support other compression algorithms.
     * If omitted or null, none is used.
     */
    compression?: string | null;
    /**
     * Configure max time (in milliseconds) to wait for each export.
     * Value must be non-negative. A value of 0 indicates no limit (infinity).
     * If omitted or null, 10000 is used.
     */
    timeout?: number | null;
    temporality_preference?: ExporterTemporalityPreference;
    default_histogram_aggregation?: ExporterDefaultHistogramAggregation;
} | null;
/**
 * Configure exporter to be OTLP with file transport.
 * If omitted, ignore.
 */
export type ExperimentalOtlpFileMetricExporter = {
    /**
     * Configure output stream.
     * Values include stdout, or scheme+destination. For example: file:///path/to/file.jsonl.
     * If omitted or null, stdout is used.
     */
    output_stream?: string | null;
    temporality_preference?: ExporterTemporalityPreference;
    default_histogram_aggregation?: ExporterDefaultHistogramAggregation;
} | null;
/**
 * Configure exporter to be console.
 * If omitted, ignore.
 */
export type ConsoleMetricExporter = {
    temporality_preference?: ExporterTemporalityPreference;
    default_histogram_aggregation?: ExporterDefaultHistogramAggregation;
} | null;
/**
 * Configure metric producer to be opencensus.
 * If omitted, ignore.
 */
export type OpenCensusMetricProducer = {} | null;
/**
 * Configure exporter to be prometheus.
 * If omitted, ignore.
 */
export type ExperimentalPrometheusMetricExporter = {
    /**
     * Configure host.
     * If omitted or null, localhost is used.
     */
    host?: string | null;
    /**
     * Configure port.
     * If omitted or null, 9464 is used.
     */
    port?: number | null;
    /**
     * Configure Prometheus Exporter to produce metrics with scope labels.
     * If omitted or null, true is used.
     */
    scope_info_enabled?: boolean | null;
    /**
     * Configure Prometheus Exporter to produce metrics with a target info metric for the resource.
     * If omitted or null, true is used.
     */
    'target_info_enabled/development'?: boolean | null;
    resource_constant_labels?: IncludeExclude;
    translation_strategy?: ExperimentalPrometheusTranslationStrategy;
} | null;
/**
 * Configure how metric names are translated to Prometheus metric names.
 * Values include:
 * * no_translation/development: Special character escaping is disabled. Type and unit suffixes are disabled. Metric names are unaltered.
 * * no_utf8_escaping_with_suffixes/development: Special character escaping is disabled. Type and unit suffixes are enabled.
 * * underscore_escaping_with_suffixes: Special character escaping is enabled. Type and unit suffixes are enabled.
 * * underscore_escaping_without_suffixes/development: Special character escaping is enabled. Type and unit suffixes are disabled. This represents classic Prometheus metric name compatibility.
 * If omitted, underscore_escaping_with_suffixes is used.
 */
export type ExperimentalPrometheusTranslationStrategy = ('underscore_escaping_with_suffixes' | 'underscore_escaping_without_suffixes/development' | 'no_utf8_escaping_with_suffixes/development' | 'no_translation/development') | null;
/**
 * Configure instrument type selection criteria.
 * Values include:
 * * counter: Synchronous counter instruments.
 * * gauge: Synchronous gauge instruments.
 * * histogram: Synchronous histogram instruments.
 * * observable_counter: Asynchronous counter instruments.
 * * observable_gauge: Asynchronous gauge instruments.
 * * observable_up_down_counter: Asynchronous up down counter instruments.
 * * up_down_counter: Synchronous up down counter instruments.
 * If omitted, all instrument types match.
 */
export type InstrumentType = ('counter' | 'gauge' | 'histogram' | 'observable_counter' | 'observable_gauge' | 'observable_up_down_counter' | 'up_down_counter') | null;
/**
 * Configures the stream to use the instrument kind to select an aggregation and advisory parameters to influence aggregation configuration parameters. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#default-aggregation for details.
 * If omitted, ignore.
 */
export type DefaultAggregation = {} | null;
/**
 * Configures the stream to ignore/drop all instrument measurements. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#drop-aggregation for details.
 * If omitted, ignore.
 */
export type DropAggregation = {} | null;
/**
 * Configures the stream to collect data for the histogram metric point using a set of explicit boundary values for histogram bucketing. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#explicit-bucket-histogram-aggregation for details
 * If omitted, ignore.
 */
export type ExplicitBucketHistogramAggregation = {
    /**
     * Configure bucket boundaries.
     * If omitted, [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000] is used.
     *
     * @minItems 0
     */
    boundaries?: number[];
    /**
     * Configure record min and max.
     * If omitted or null, true is used.
     */
    record_min_max?: boolean | null;
} | null;
/**
 * Configures the stream to collect data for the exponential histogram metric point, which uses a base-2 exponential formula to determine bucket boundaries and an integer scale parameter to control resolution. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#base2-exponential-bucket-histogram-aggregation for details.
 * If omitted, ignore.
 */
export type Base2ExponentialBucketHistogramAggregation = {
    /**
     * Configure the max scale factor.
     * If omitted or null, 20 is used.
     */
    max_scale?: number | null;
    /**
     * Configure the maximum number of buckets in each of the positive and negative ranges, not counting the special zero bucket.
     * If omitted or null, 160 is used.
     */
    max_size?: number | null;
    /**
     * Configure whether or not to record min and max.
     * If omitted or null, true is used.
     */
    record_min_max?: boolean | null;
} | null;
/**
 * Configures the stream to collect data using the last measurement. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#last-value-aggregation for details.
 * If omitted, ignore.
 */
export type LastValueAggregation = {} | null;
/**
 * Configures the stream to collect the arithmetic sum of measurement values. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#sum-aggregation for details.
 * If omitted, ignore.
 */
export type SumAggregation = {} | null;
/**
 * Configure the exemplar filter.
 * Values include:
 * * always_off: ExemplarFilter which makes no measurements eligible for being an Exemplar.
 * * always_on: ExemplarFilter which makes all measurements eligible for being an Exemplar.
 * * trace_based: ExemplarFilter which makes measurements recorded in the context of a sampled parent span eligible for being an Exemplar.
 * If omitted, trace_based is used.
 */
export type ExemplarFilter = ('always_on' | 'always_off' | 'trace_based') | null;
/**
 * Include the w3c trace context propagator.
 * If omitted, ignore.
 */
export type TraceContextPropagator = {} | null;
/**
 * Include the w3c baggage propagator.
 * If omitted, ignore.
 */
export type BaggagePropagator = {} | null;
/**
 * Include the zipkin b3 propagator.
 * If omitted, ignore.
 */
export type B3Propagator = {} | null;
/**
 * Include the zipkin b3 multi propagator.
 * If omitted, ignore.
 */
export type B3MultiPropagator = {} | null;
/**
 * Configure sampler to be always_off.
 * If omitted, ignore.
 */
export type AlwaysOffSampler = {} | null;
/**
 * Configure sampler to be always_on.
 * If omitted, ignore.
 */
export type AlwaysOnSampler = {} | null;
/**
 * Configure sampler to be always_off.
 * If omitted, ignore.
 */
export type ExperimentalComposableAlwaysOffSampler = {} | null;
/**
 * Configure sampler to be always_on.
 * If omitted, ignore.
 */
export type ExperimentalComposableAlwaysOnSampler = {} | null;
/**
 * Configure sampler to be probability.
 * If omitted, ignore.
 */
export type ExperimentalComposableProbabilitySampler = {
    /**
     * Configure ratio.
     * If omitted or null, 1.0 is used.
     */
    ratio?: number | null;
} | null;
/**
 * Configure sampler to be rule_based.
 * If omitted, ignore.
 */
export type ExperimentalComposableRuleBasedSampler = {
    /**
     * The rules for the sampler, matched in order.
     * Each rule can have multiple match conditions. All conditions must match for the rule to match.
     * If no conditions are specified, the rule matches all spans that reach it.
     * If no rules match, the span is not sampled.
     * If omitted, no span is sampled.
     *
     * @minItems 1
     */
    rules?: ExperimentalComposableRuleBasedSamplerRule[];
} | null;
export type SpanKind = ('internal' | 'server' | 'client' | 'producer' | 'consumer') | null;
export type ExperimentalSpanParent = ('none' | 'remote' | 'local') | null;
/**
 * Configure sampler to be jaeger_remote.
 * If omitted, ignore.
 */
export type ExperimentalJaegerRemoteSampler = {
    /**
     * Configure the endpoint of the jaeger remote sampling service.
     * Property is required and must be non-null.
     */
    endpoint: string;
    /**
     * Configure the polling interval (in milliseconds) to fetch from the remote sampling service.
     * If omitted or null, 60000 is used.
     */
    interval?: number | null;
    initial_sampler: Sampler;
} | null;
/**
 * Configure sampler to be parent_based.
 * If omitted, ignore.
 */
export type ParentBasedSampler = {
    root?: Sampler;
    remote_parent_sampled?: Sampler;
    remote_parent_not_sampled?: Sampler;
    local_parent_sampled?: Sampler;
    local_parent_not_sampled?: Sampler;
} | null;
/**
 * Configure sampler to be probability.
 * If omitted, ignore.
 */
export type ExperimentalProbabilitySampler = {
    /**
     * Configure ratio.
     * If omitted or null, 1.0 is used.
     */
    ratio?: number | null;
} | null;
/**
 * Configure sampler to be trace_id_ratio_based.
 * If omitted, ignore.
 */
export type TraceIdRatioBasedSampler = {
    /**
     * Configure trace_id_ratio.
     * If omitted or null, 1.0 is used.
     */
    ratio?: number | null;
} | null;
/**
 * Configure the ID generator to randomly generate TraceIds and SpanIds (spec default).
 * If omitted, ignore.
 */
export type RandomIdGenerator = {} | null;
/**
 * The attribute type.
 * Values include:
 * * bool: Boolean attribute value.
 * * bool_array: Boolean array attribute value.
 * * double: Double attribute value.
 * * double_array: Double array attribute value.
 * * int: Integer attribute value.
 * * int_array: Integer array attribute value.
 * * string: String attribute value.
 * * string_array: String array attribute value.
 * If omitted, string is used.
 */
export type AttributeType = ('string' | 'bool' | 'int' | 'double' | 'string_array' | 'bool_array' | 'int_array' | 'double_array') | null;
/**
 * Enable the container resource detector, which populates container.* attributes.
 * If omitted, ignore.
 */
export type ExperimentalContainerResourceDetector = {} | null;
/**
 * Enable the host resource detector, which populates host.* and os.* attributes.
 * If omitted, ignore.
 */
export type ExperimentalHostResourceDetector = {} | null;
/**
 * Enable the process resource detector, which populates process.* attributes.
 * If omitted, ignore.
 */
export type ExperimentalProcessResourceDetector = {} | null;
/**
 * Enable the service detector, which populates service.name based on the OTEL_SERVICE_NAME environment variable and service.instance.id.
 * If omitted, ignore.
 */
export type ExperimentalServiceResourceDetector = {} | null;
export interface ConfigurationModel {
    /**
     * The file format version.
     * Represented as a string including the semver major, minor version numbers (and optionally the meta tag). For example: "0.4", "1.0-rc.2", "1.0" (after stable release).
     * See https://github.com/open-telemetry/opentelemetry-configuration/blob/main/VERSIONING.md for more details.
     * The yaml format is documented at https://github.com/open-telemetry/opentelemetry-configuration/tree/main/schema
     * Property is required and must be non-null.
     */
    file_format?: string;
    /**
     * Configure if the SDK is disabled or not.
     * If omitted or null, false is used.
     */
    disabled?: boolean | null;
    log_level?: SeverityNumber;
    attribute_limits?: AttributeLimits;
    logger_provider?: LoggerProvider;
    meter_provider?: MeterProvider;
    propagator?: Propagator;
    tracer_provider?: TracerProvider;
    resource?: Resource;
    'instrumentation/development'?: ExperimentalInstrumentation;
    distribution?: Distribution;
    [k: string]: any;
}
/**
 * Configure general attribute limits. See also tracer_provider.limits, logger_provider.limits.
 * If omitted, default values as described in AttributeLimits are used.
 */
export interface AttributeLimits {
    /**
     * Configure max attribute value size.
     * Value must be non-negative.
     * If omitted or null, there is no limit.
     */
    attribute_value_length_limit?: number | null;
    /**
     * Configure max attribute count.
     * Value must be non-negative.
     * If omitted or null, 128 is used.
     */
    attribute_count_limit?: number | null;
}
/**
 * Configure logger provider.
 * If omitted, a noop logger provider is used.
 */
export interface LoggerProvider {
    /**
     * Configure log record processors.
     * Property is required and must be non-null.
     *
     * @minItems 1
     */
    processors: LogRecordProcessor[];
    limits?: LogRecordLimits;
    'logger_configurator/development'?: ExperimentalLoggerConfigurator;
}
export interface LogRecordProcessor {
    batch?: BatchLogRecordProcessor;
    simple?: SimpleLogRecordProcessor;
    'event_to_span_event_bridge/development'?: ExperimentalEventToSpanEventBridgeLogRecordProcessor;
    [k: string]: object | null | undefined;
}
/**
 * Configure a batch log record processor.
 * If omitted, ignore.
 */
export interface BatchLogRecordProcessor {
    /**
     * Configure delay interval (in milliseconds) between two consecutive exports.
     * Value must be non-negative.
     * If omitted or null, 1000 is used.
     */
    schedule_delay?: number | null;
    /**
     * Configure maximum allowed time (in milliseconds) to export data.
     * Value must be non-negative. A value of 0 indicates no limit (infinity).
     * If omitted or null, 30000 is used.
     */
    export_timeout?: number | null;
    /**
     * Configure maximum queue size. Value must be positive.
     * If omitted or null, 2048 is used.
     */
    max_queue_size?: number | null;
    /**
     * Configure maximum batch size. Value must be positive.
     * If omitted or null, 512 is used.
     */
    max_export_batch_size?: number | null;
    exporter: LogRecordExporter;
}
/**
 * Configure exporter.
 * Property is required and must be non-null.
 */
export interface LogRecordExporter {
    otlp_http?: OtlpHttpExporter;
    otlp_grpc?: OtlpGrpcExporter;
    'otlp_file/development'?: ExperimentalOtlpFileExporter;
    console?: ConsoleExporter;
    [k: string]: object | null | undefined;
}
export interface NameStringValuePair {
    /**
     * The name of the pair.
     * Property is required and must be non-null.
     */
    name: string;
    /**
     * The value of the pair.
     * Property must be present, but if null the behavior is dependent on usage context.
     */
    value: string | null;
}
/**
 * Configure a simple log record processor.
 * If omitted, ignore.
 */
export interface SimpleLogRecordProcessor {
    exporter: LogRecordExporter;
}
/**
 * Configure log record limits. See also attribute_limits.
 * If omitted, default values as described in LogRecordLimits are used.
 */
export interface LogRecordLimits {
    /**
     * Configure max attribute value size. Overrides .attribute_limits.attribute_value_length_limit.
     * Value must be non-negative.
     * If omitted or null, there is no limit.
     */
    attribute_value_length_limit?: number | null;
    /**
     * Configure max attribute count. Overrides .attribute_limits.attribute_count_limit.
     * Value must be non-negative.
     * If omitted or null, 128 is used.
     */
    attribute_count_limit?: number | null;
}
/**
 * Configure loggers.
 * If omitted, all loggers use default values as described in ExperimentalLoggerConfig.
 */
export interface ExperimentalLoggerConfigurator {
    default_config?: ExperimentalLoggerConfig;
    /**
     * Configure loggers.
     * If omitted, all loggers use .default_config.
     *
     * @minItems 1
     */
    loggers?: ExperimentalLoggerMatcherAndConfig[];
}
/**
 * Configure the default logger config used there is no matching entry in .logger_configurator/development.loggers.
 * If omitted, unmatched .loggers use default values as described in ExperimentalLoggerConfig.
 */
export interface ExperimentalLoggerConfig {
    /**
     * Configure if the logger is enabled or not.
     * If omitted or null, true is used.
     */
    enabled?: boolean | null;
    minimum_severity?: SeverityNumber;
    /**
     * Configure trace based filtering.
     * If true, log records associated with unsampled trace contexts traces are not processed. If false, or if a log record is not associated with a trace context, trace based filtering is not applied.
     * If omitted or null, trace based filtering is not applied.
     */
    trace_based?: boolean | null;
}
export interface ExperimentalLoggerMatcherAndConfig {
    /**
     * Configure logger names to match. Matching is case-sensitive, evaluated as follows:
     *
     *  * If the logger name exactly matches.
     *  * If the logger name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.
     * Property is required and must be non-null.
     */
    name: string;
    config: ExperimentalLoggerConfig;
}
/**
 * Configure meter provider.
 * If omitted, a noop meter provider is used.
 */
export interface MeterProvider {
    /**
     * Configure metric readers.
     * Property is required and must be non-null.
     *
     * @minItems 1
     */
    readers: MetricReader[];
    /**
     * Configure views.
     * Each view has a selector which determines the instrument(s) it applies to, and a configuration for the resulting stream(s).
     * If omitted, no views are registered.
     *
     * @minItems 1
     */
    views?: View[];
    exemplar_filter?: ExemplarFilter;
    'meter_configurator/development'?: ExperimentalMeterConfigurator;
}
export interface MetricReader {
    periodic?: PeriodicMetricReader;
    pull?: PullMetricReader;
}
/**
 * Configure a periodic metric reader.
 * If omitted, ignore.
 */
export interface PeriodicMetricReader {
    /**
     * Configure delay interval (in milliseconds) between start of two consecutive exports.
     * Value must be non-negative.
     * If omitted or null, 60000 is used.
     */
    interval?: number | null;
    /**
     * Configure maximum allowed time (in milliseconds) to export data.
     * Value must be non-negative. A value of 0 indicates no limit (infinity).
     * If omitted or null, 30000 is used.
     */
    timeout?: number | null;
    /**
     * Configure maximum export batch size.
     * If omitted or null, no limit is used.
     */
    'max_export_batch_size/development'?: number | null;
    exporter: PushMetricExporter;
    /**
     * Configure metric producers.
     * If omitted, no metric producers are added.
     *
     * @minItems 1
     */
    producers?: MetricProducer[];
    cardinality_limits?: CardinalityLimits;
}
/**
 * Configure exporter.
 * Property is required and must be non-null.
 */
export interface PushMetricExporter {
    otlp_http?: OtlpHttpMetricExporter;
    otlp_grpc?: OtlpGrpcMetricExporter;
    'otlp_file/development'?: ExperimentalOtlpFileMetricExporter;
    console?: ConsoleMetricExporter;
    [k: string]: object | null | undefined;
}
export interface MetricProducer {
    opencensus?: OpenCensusMetricProducer;
    [k: string]: object | null | undefined;
}
/**
 * Configure cardinality limits.
 * If omitted, default values as described in CardinalityLimits are used.
 */
export interface CardinalityLimits {
    /**
     * Configure default cardinality limit for all instrument types.
     * Instrument-specific cardinality limits take priority.
     * If omitted or null, 2000 is used.
     */
    default?: number | null;
    /**
     * Configure default cardinality limit for counter instruments.
     * If omitted or null, the value from .default is used.
     */
    counter?: number | null;
    /**
     * Configure default cardinality limit for gauge instruments.
     * If omitted or null, the value from .default is used.
     */
    gauge?: number | null;
    /**
     * Configure default cardinality limit for histogram instruments.
     * If omitted or null, the value from .default is used.
     */
    histogram?: number | null;
    /**
     * Configure default cardinality limit for observable_counter instruments.
     * If omitted or null, the value from .default is used.
     */
    observable_counter?: number | null;
    /**
     * Configure default cardinality limit for observable_gauge instruments.
     * If omitted or null, the value from .default is used.
     */
    observable_gauge?: number | null;
    /**
     * Configure default cardinality limit for observable_up_down_counter instruments.
     * If omitted or null, the value from .default is used.
     */
    observable_up_down_counter?: number | null;
    /**
     * Configure default cardinality limit for up_down_counter instruments.
     * If omitted or null, the value from .default is used.
     */
    up_down_counter?: number | null;
}
/**
 * Configure a pull based metric reader.
 * If omitted, ignore.
 */
export interface PullMetricReader {
    exporter: PullMetricExporter;
    /**
     * Configure metric producers.
     * If omitted, no metric producers are added.
     *
     * @minItems 1
     */
    producers?: MetricProducer[];
    cardinality_limits?: CardinalityLimits;
}
/**
 * Configure exporter.
 * Property is required and must be non-null.
 */
export interface PullMetricExporter {
    'prometheus/development'?: ExperimentalPrometheusMetricExporter;
    [k: string]: object | null | undefined;
}
/**
 * Configure Prometheus Exporter to add resource attributes as metrics attributes, where the resource attribute keys match the patterns.
 * If omitted, no resource attributes are added.
 */
export interface IncludeExclude {
    /**
     * Configure list of value patterns to include.
     * Matching is case-sensitive. Values are evaluated to match as follows:
     *  * If the value exactly matches.
     *  * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.
     * If omitted, all values are included.
     *
     * @minItems 1
     */
    included?: string[];
    /**
     * Configure list of value patterns to exclude. Applies after .included (i.e. excluded has higher priority than included).
     * Matching is case-sensitive. Values are evaluated to match as follows:
     *  * If the value exactly matches.
     *  * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.
     * If omitted, .included attributes are included.
     *
     * @minItems 1
     */
    excluded?: string[];
}
export interface View {
    selector: ViewSelector;
    stream: ViewStream;
}
/**
 * Configure view selector.
 * Selection criteria is additive as described in https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#instrument-selection-criteria.
 * Property is required and must be non-null.
 */
export interface ViewSelector {
    /**
     * Configure instrument name selection criteria.
     * If omitted or null, all instrument names match.
     */
    instrument_name?: string | null;
    instrument_type?: InstrumentType;
    /**
     * Configure the instrument unit selection criteria.
     * If omitted or null, all instrument units match.
     */
    unit?: string | null;
    /**
     * Configure meter name selection criteria.
     * If omitted or null, all meter names match.
     */
    meter_name?: string | null;
    /**
     * Configure meter version selection criteria.
     * If omitted or null, all meter versions match.
     */
    meter_version?: string | null;
    /**
     * Configure meter schema url selection criteria.
     * If omitted or null, all meter schema URLs match.
     */
    meter_schema_url?: string | null;
}
/**
 * Configure view stream.
 * Property is required and must be non-null.
 */
export interface ViewStream {
    /**
     * Configure metric name of the resulting stream(s).
     * If omitted or null, the instrument's original name is used.
     */
    name?: string | null;
    /**
     * Configure metric description of the resulting stream(s).
     * If omitted or null, the instrument's origin description is used.
     */
    description?: string | null;
    aggregation?: Aggregation;
    /**
     * Configure the aggregation cardinality limit.
     * If omitted or null, the metric reader's default cardinality limit is used.
     */
    aggregation_cardinality_limit?: number | null;
    attribute_keys?: IncludeExclude;
}
/**
 * Configure aggregation of the resulting stream(s).
 * If omitted, default is used.
 */
export interface Aggregation {
    default?: DefaultAggregation;
    drop?: DropAggregation;
    explicit_bucket_histogram?: ExplicitBucketHistogramAggregation;
    base2_exponential_bucket_histogram?: Base2ExponentialBucketHistogramAggregation;
    last_value?: LastValueAggregation;
    sum?: SumAggregation;
}
/**
 * Configure meters.
 * If omitted, all meters use default values as described in ExperimentalMeterConfig.
 */
export interface ExperimentalMeterConfigurator {
    default_config?: ExperimentalMeterConfig;
    /**
     * Configure meters.
     * If omitted, all meters used .default_config.
     *
     * @minItems 1
     */
    meters?: ExperimentalMeterMatcherAndConfig[];
}
/**
 * Configure the default meter config used there is no matching entry in .meter_configurator/development.meters.
 * If omitted, unmatched .meters use default values as described in ExperimentalMeterConfig.
 */
export interface ExperimentalMeterConfig {
    /**
     * Configure if the meter is enabled or not.
     * If omitted, true is used.
     */
    enabled?: boolean;
}
export interface ExperimentalMeterMatcherAndConfig {
    /**
     * Configure meter names to match. Matching is case-sensitive, evaluated as follows:
     *
     *  * If the meter name exactly matches.
     *  * If the meter name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.
     * Property is required and must be non-null.
     */
    name: string;
    config: ExperimentalMeterConfig;
}
/**
 * Configure text map context propagators.
 * If omitted, a noop propagator is used.
 */
export interface Propagator {
    /**
     * Configure the propagators in the composite text map propagator. Entries from .composite_list are appended to the list here with duplicates filtered out.
     * Built-in propagator keys include: tracecontext, baggage, b3, b3multi. Known third party keys include: xray.
     * If omitted, and .composite_list is omitted or null, a noop propagator is used.
     *
     * @minItems 1
     */
    composite?: TextMapPropagator[];
    /**
     * Configure the propagators in the composite text map propagator. Entries are appended to .composite with duplicates filtered out.
     * The value is a comma separated list of propagator identifiers matching the format of OTEL_PROPAGATORS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/configuration/sdk-environment-variables.md#general-sdk-configuration for details.
     * Built-in propagator identifiers include: tracecontext, baggage, b3, b3multi. Known third party identifiers include: xray.
     * If omitted or null, and .composite is omitted or null, a noop propagator is used.
     */
    composite_list?: string | null;
}
export interface TextMapPropagator {
    tracecontext?: TraceContextPropagator;
    baggage?: BaggagePropagator;
    b3?: B3Propagator;
    b3multi?: B3MultiPropagator;
    [k: string]: object | null | undefined;
}
/**
 * Configure tracer provider.
 * If omitted, a noop tracer provider is used.
 */
export interface TracerProvider {
    /**
     * Configure span processors.
     * Property is required and must be non-null.
     *
     * @minItems 1
     */
    processors: SpanProcessor[];
    limits?: SpanLimits;
    sampler?: Sampler;
    id_generator?: IdGenerator;
    'tracer_configurator/development'?: ExperimentalTracerConfigurator;
}
export interface SpanProcessor {
    batch?: BatchSpanProcessor;
    simple?: SimpleSpanProcessor;
    [k: string]: object | null | undefined;
}
/**
 * Configure a batch span processor.
 * If omitted, ignore.
 */
export interface BatchSpanProcessor {
    /**
     * Configure delay interval (in milliseconds) between two consecutive exports.
     * Value must be non-negative.
     * If omitted or null, 5000 is used.
     */
    schedule_delay?: number | null;
    /**
     * Configure maximum allowed time (in milliseconds) to export data.
     * Value must be non-negative. A value of 0 indicates no limit (infinity).
     * If omitted or null, 30000 is used.
     */
    export_timeout?: number | null;
    /**
     * Configure maximum queue size. Value must be positive.
     * If omitted or null, 2048 is used.
     */
    max_queue_size?: number | null;
    /**
     * Configure maximum batch size. Value must be positive.
     * If omitted or null, 512 is used.
     */
    max_export_batch_size?: number | null;
    exporter: SpanExporter;
}
/**
 * Configure exporter.
 * Property is required and must be non-null.
 */
export interface SpanExporter {
    otlp_http?: OtlpHttpExporter;
    otlp_grpc?: OtlpGrpcExporter;
    'otlp_file/development'?: ExperimentalOtlpFileExporter;
    console?: ConsoleExporter;
    [k: string]: object | null | undefined;
}
/**
 * Configure a simple span processor.
 * If omitted, ignore.
 */
export interface SimpleSpanProcessor {
    exporter: SpanExporter;
}
/**
 * Configure span limits. See also attribute_limits.
 * If omitted, default values as described in SpanLimits are used.
 */
export interface SpanLimits {
    /**
     * Configure max attribute value size. Overrides .attribute_limits.attribute_value_length_limit.
     * Value must be non-negative.
     * If omitted or null, there is no limit.
     */
    attribute_value_length_limit?: number | null;
    /**
     * Configure max attribute count. Overrides .attribute_limits.attribute_count_limit.
     * Value must be non-negative.
     * If omitted or null, 128 is used.
     */
    attribute_count_limit?: number | null;
    /**
     * Configure max span event count.
     * Value must be non-negative.
     * If omitted or null, 128 is used.
     */
    event_count_limit?: number | null;
    /**
     * Configure max span link count.
     * Value must be non-negative.
     * If omitted or null, 128 is used.
     */
    link_count_limit?: number | null;
    /**
     * Configure max attributes per span event.
     * Value must be non-negative.
     * If omitted or null, 128 is used.
     */
    event_attribute_count_limit?: number | null;
    /**
     * Configure max attributes per span link.
     * Value must be non-negative.
     * If omitted or null, 128 is used.
     */
    link_attribute_count_limit?: number | null;
}
/**
 * Configure the sampler.
 * If omitted, parent based sampler with a root of always_on is used.
 */
export interface Sampler {
    always_off?: AlwaysOffSampler;
    always_on?: AlwaysOnSampler;
    'composite/development'?: ExperimentalComposableSampler;
    'jaeger_remote/development'?: ExperimentalJaegerRemoteSampler;
    parent_based?: ParentBasedSampler;
    'probability/development'?: ExperimentalProbabilitySampler;
    trace_id_ratio_based?: TraceIdRatioBasedSampler;
    [k: string]: object | null | undefined;
}
/**
 * Configure sampler to be composite.
 * If omitted, ignore.
 */
export interface ExperimentalComposableSampler {
    always_off?: ExperimentalComposableAlwaysOffSampler;
    always_on?: ExperimentalComposableAlwaysOnSampler;
    parent_threshold?: ExperimentalComposableParentThresholdSampler;
    probability?: ExperimentalComposableProbabilitySampler;
    rule_based?: ExperimentalComposableRuleBasedSampler;
    [k: string]: object | null | undefined;
}
/**
 * Configure sampler to be parent_threshold.
 * If omitted, ignore.
 */
export interface ExperimentalComposableParentThresholdSampler {
    root: ExperimentalComposableSampler;
}
/**
 * A rule for ExperimentalComposableRuleBasedSampler. A rule can have multiple match conditions - the sampler will be applied if all match.
 * If no conditions are specified, the rule matches all spans that reach it.
 */
export interface ExperimentalComposableRuleBasedSamplerRule {
    attribute_values?: ExperimentalComposableRuleBasedSamplerRuleAttributeValues;
    attribute_patterns?: ExperimentalComposableRuleBasedSamplerRuleAttributePatterns;
    /**
     * The span kinds to match. If the span's kind matches any of these, it matches.
     * Values include:
     * * client: client, a client span.
     * * consumer: consumer, a consumer span.
     * * internal: internal, an internal span.
     * * producer: producer, a producer span.
     * * server: server, a server span.
     * If omitted, ignore.
     *
     * @minItems 1
     */
    span_kinds?: SpanKind[];
    /**
     * The parent span types to match.
     * Values include:
     * * local: local, a local parent.
     * * none: none, no parent, i.e., the trace root.
     * * remote: remote, a remote parent.
     * If omitted, ignore.
     *
     * @minItems 1
     */
    parent?: ExperimentalSpanParent[];
    sampler: ExperimentalComposableSampler;
}
/**
 * Values to match against a single attribute. Non-string attributes are matched using their string representation:
 * for example, a value of "404" would match the http.response.status_code 404. For array attributes, if any
 * item matches, it is considered a match.
 * If omitted, ignore.
 */
export interface ExperimentalComposableRuleBasedSamplerRuleAttributeValues {
    /**
     * The attribute key to match against.
     * Property is required and must be non-null.
     */
    key: string;
    /**
     * The attribute values to match against. If the attribute's value matches any of these, it matches.
     * Property is required and must be non-null.
     *
     * @minItems 1
     */
    values: string[];
}
/**
 * Patterns to match against a single attribute. Non-string attributes are matched using their string representation:
 * for example, a pattern of "4*" would match any http.response.status_code in 400-499. For array attributes, if any
 * item matches, it is considered a match.
 * If omitted, ignore.
 */
export interface ExperimentalComposableRuleBasedSamplerRuleAttributePatterns {
    /**
     * The attribute key to match against.
     * Property is required and must be non-null.
     */
    key: string;
    /**
     * Configure list of value patterns to include.
     * Matching is case-sensitive. Values are evaluated to match as follows:
     *  * If the value exactly matches.
     *  * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.
     * If omitted, all values are included.
     *
     * @minItems 1
     */
    included?: string[];
    /**
     * Configure list of value patterns to exclude. Applies after .included (i.e. excluded has higher priority than included).
     * Matching is case-sensitive. Values are evaluated to match as follows:
     *  * If the value exactly matches.
     *  * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.
     * If omitted, .included attributes are included.
     *
     * @minItems 1
     */
    excluded?: string[];
}
/**
 * Configure the trace and span ID generator.
 * If omitted, RandomIdGenerator is used.
 */
export interface IdGenerator {
    random?: RandomIdGenerator;
    [k: string]: object | null | undefined;
}
/**
 * Configure tracers.
 * If omitted, all tracers use default values as described in ExperimentalTracerConfig.
 */
export interface ExperimentalTracerConfigurator {
    default_config?: ExperimentalTracerConfig;
    /**
     * Configure tracers.
     * If omitted, all tracers use .default_config.
     *
     * @minItems 1
     */
    tracers?: ExperimentalTracerMatcherAndConfig[];
}
/**
 * Configure the default tracer config used there is no matching entry in .tracer_configurator/development.tracers.
 * If omitted, unmatched .tracers use default values as described in ExperimentalTracerConfig.
 */
export interface ExperimentalTracerConfig {
    /**
     * Configure if the tracer is enabled or not.
     * If omitted, true is used.
     */
    enabled?: boolean;
}
export interface ExperimentalTracerMatcherAndConfig {
    /**
     * Configure tracer names to match. Matching is case-sensitive, evaluated as follows:
     *
     *  * If the tracer name exactly matches.
     *  * If the tracer name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.
     * Property is required and must be non-null.
     */
    name: string;
    config: ExperimentalTracerConfig;
}
/**
 * Configure resource for all signals.
 * If omitted, the default resource is used.
 */
export interface Resource {
    /**
     * Configure resource attributes. Entries have higher priority than entries from .resource.attributes_list.
     * If omitted, no resource attributes are added.
     *
     * @minItems 1
     */
    attributes?: AttributeNameValue[];
    'detection/development'?: ExperimentalResourceDetection;
    /**
     * Configure resource schema URL.
     * If omitted or null, no schema URL is used.
     */
    schema_url?: string | null;
    /**
     * Configure resource attributes. Entries have lower priority than entries from .resource.attributes.
     * The value is a list of comma separated key-value pairs matching the format of OTEL_RESOURCE_ATTRIBUTES. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/configuration/sdk-environment-variables.md#general-sdk-configuration for details.
     * If omitted or null, no resource attributes are added.
     */
    attributes_list?: string | null;
}
export interface AttributeNameValue {
    /**
     * The attribute name.
     * Property is required and must be non-null.
     */
    name: string;
    /**
     * The attribute value.
     * The type of value must match .type.
     * Property must be present, but if null the entry is ignored.
     */
    value: string | number | boolean | null | string[] | boolean[] | number[];
    type?: AttributeType;
}
/**
 * Configure resource detection.
 * If omitted, resource detection is disabled.
 */
export interface ExperimentalResourceDetection {
    attributes?: IncludeExclude;
    /**
     * Configure resource detectors.
     * Resource detector names are dependent on the SDK language ecosystem. Please consult documentation for each respective language.
     * If omitted, no resource detectors are enabled.
     *
     * @minItems 1
     */
    detectors?: ExperimentalResourceDetector[];
}
export interface ExperimentalResourceDetector {
    container?: ExperimentalContainerResourceDetector;
    host?: ExperimentalHostResourceDetector;
    process?: ExperimentalProcessResourceDetector;
    service?: ExperimentalServiceResourceDetector;
    [k: string]: object | null | undefined;
}
/**
 * Configure instrumentation.
 * If omitted, instrumentation defaults are used.
 */
export interface ExperimentalInstrumentation {
    general?: ExperimentalGeneralInstrumentation;
    cpp?: ExperimentalLanguageSpecificInstrumentation;
    dotnet?: ExperimentalLanguageSpecificInstrumentation;
    erlang?: ExperimentalLanguageSpecificInstrumentation;
    go?: ExperimentalLanguageSpecificInstrumentation;
    java?: ExperimentalLanguageSpecificInstrumentation;
    js?: ExperimentalLanguageSpecificInstrumentation;
    php?: ExperimentalLanguageSpecificInstrumentation;
    python?: ExperimentalLanguageSpecificInstrumentation;
    ruby?: ExperimentalLanguageSpecificInstrumentation;
    rust?: ExperimentalLanguageSpecificInstrumentation;
    swift?: ExperimentalLanguageSpecificInstrumentation;
}
/**
 * Configure general SemConv options that may apply to multiple languages and instrumentations.
 * Instrumenation may merge general config options with the language specific configuration at .instrumentation.<language>.
 * If omitted, default values as described in ExperimentalGeneralInstrumentation are used.
 */
export interface ExperimentalGeneralInstrumentation {
    http?: ExperimentalHttpInstrumentation;
    code?: ExperimentalCodeInstrumentation;
    db?: ExperimentalDbInstrumentation;
    gen_ai?: ExperimentalGenAiInstrumentation;
    messaging?: ExperimentalMessagingInstrumentation;
    rpc?: ExperimentalRpcInstrumentation;
    sanitization?: ExperimentalSanitization;
    /**
     * Configure semantic convention stability opt-in as a comma-separated list.
     * This property follows the format and semantics of the OTEL_SEMCONV_STABILITY_OPT_IN environment variable.
     * Controls the emission of stable vs. experimental semantic conventions for instrumentation.
     * This setting is only intended for migrating from experimental to stable semantic conventions.
     *
     * Known values include:
     * - http: Emit stable HTTP and networking conventions only
     * - http/dup: Emit both old and stable HTTP and networking conventions (for phased migration)
     * - database: Emit stable database conventions only
     * - database/dup: Emit both old and stable database conventions (for phased migration)
     * - rpc: Emit stable RPC conventions only
     * - rpc/dup: Emit both experimental and stable RPC conventions (for phased migration)
     * - messaging: Emit stable messaging conventions only
     * - messaging/dup: Emit both old and stable messaging conventions (for phased migration)
     * - code: Emit stable code conventions only
     * - code/dup: Emit both old and stable code conventions (for phased migration)
     *
     * Multiple values can be specified as a comma-separated list (e.g., "http,database/dup").
     * Additional signal types may be supported in future versions.
     *
     * Domain-specific semconv properties (e.g., .instrumentation/development.general.db.semconv) take precedence over this general setting.
     *
     * See:
     * - HTTP migration: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/
     * - Database migration: https://opentelemetry.io/docs/specs/semconv/database/
     * - RPC: https://opentelemetry.io/docs/specs/semconv/rpc/
     * - Messaging: https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/
     * If omitted or null, no opt-in is configured and instrumentations continue emitting their default semantic convention version.
     */
    stability_opt_in_list?: string | null;
}
/**
 * Configure instrumentations following the http semantic conventions.
 * See http semantic conventions: https://opentelemetry.io/docs/specs/semconv/http/
 * If omitted, defaults as described in ExperimentalHttpInstrumentation are used.
 */
export interface ExperimentalHttpInstrumentation {
    semconv?: ExperimentalSemconvConfig;
    client?: ExperimentalHttpClientInstrumentation;
    server?: ExperimentalHttpServerInstrumentation;
}
/**
 * Configure HTTP semantic convention version and migration behavior.
 *
 * This property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.
 *
 * See HTTP migration: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/
 * If omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.
 */
export interface ExperimentalSemconvConfig {
    /**
     * The target semantic convention version for this domain (e.g., 1).
     * If omitted or null, the latest stable version is used, or if no stable version is available and .experimental is true then the latest experimental version is used.
     */
    version?: number | null;
    /**
     * Use latest experimental semantic conventions (before stable is available or to enable experimental features on top of stable conventions).
     * If omitted or null, false is used.
     */
    experimental?: boolean | null;
    /**
     * When true, also emit the previous major version alongside the target version.
     * For version=1, the previous version refers to the pre-stable conventions that the instrumentation emitted before the first stable semantic convention version was defined.
     * For version=2 and above, the previous version is the prior stable major version (e.g., version=2, dual_emit=true emits both v2 and v1).
     * Enables dual-emit for phased migration between versions.
     * If omitted or null, false is used.
     */
    dual_emit?: boolean | null;
}
/**
 * Configure instrumentations following the http client semantic conventions.
 * If omitted, defaults as described in ExperimentalHttpClientInstrumentation are used.
 */
export interface ExperimentalHttpClientInstrumentation {
    /**
     * Configure headers to capture for outbound http requests.
     * If omitted, no outbound request headers are captured.
     *
     * @minItems 1
     */
    request_captured_headers?: string[];
    /**
     * Configure headers to capture for inbound http responses.
     * If omitted, no inbound response headers are captured.
     *
     * @minItems 1
     */
    response_captured_headers?: string[];
    /**
     * Override the default list of known HTTP methods.
     * Known methods are case-sensitive.
     * This is a full override of the default known methods, not a list of known methods in addition to the defaults.
     * If omitted, HTTP methods GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH are known.
     *
     * @minItems 0
     */
    known_methods?: string[];
}
/**
 * Configure instrumentations following the http server semantic conventions.
 * If omitted, defaults as described in ExperimentalHttpServerInstrumentation are used.
 */
export interface ExperimentalHttpServerInstrumentation {
    /**
     * Configure headers to capture for inbound http requests.
     * If omitted, no request headers are captured.
     *
     * @minItems 1
     */
    request_captured_headers?: string[];
    /**
     * Configure headers to capture for outbound http responses.
     * If omitted, no response headers are captures.
     *
     * @minItems 1
     */
    response_captured_headers?: string[];
    /**
     * Override the default list of known HTTP methods.
     * Known methods are case-sensitive.
     * This is a full override of the default known methods, not a list of known methods in addition to the defaults.
     * If omitted, HTTP methods GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH are known.
     *
     * @minItems 0
     */
    known_methods?: string[];
}
/**
 * Configure instrumentations following the code semantic conventions.
 * See code semantic conventions: https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/
 * If omitted, defaults as described in ExperimentalCodeInstrumentation are used.
 */
export interface ExperimentalCodeInstrumentation {
    semconv?: ExperimentalSemconvConfig;
}
/**
 * Configure instrumentations following the database semantic conventions.
 * See database semantic conventions: https://opentelemetry.io/docs/specs/semconv/database/
 * If omitted, defaults as described in ExperimentalDbInstrumentation are used.
 */
export interface ExperimentalDbInstrumentation {
    semconv?: ExperimentalSemconvConfig;
}
/**
 * Configure instrumentations following the GenAI semantic conventions.
 * See GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * If omitted, defaults as described in ExperimentalGenAiInstrumentation are used.
 */
export interface ExperimentalGenAiInstrumentation {
    semconv?: ExperimentalSemconvConfig;
}
/**
 * Configure instrumentations following the messaging semantic conventions.
 * See messaging semantic conventions: https://opentelemetry.io/docs/specs/semconv/messaging/
 * If omitted, defaults as described in ExperimentalMessagingInstrumentation are used.
 */
export interface ExperimentalMessagingInstrumentation {
    semconv?: ExperimentalSemconvConfig;
}
/**
 * Configure instrumentations following the RPC semantic conventions.
 * See RPC semantic conventions: https://opentelemetry.io/docs/specs/semconv/rpc/
 * If omitted, defaults as described in ExperimentalRpcInstrumentation are used.
 */
export interface ExperimentalRpcInstrumentation {
    semconv?: ExperimentalSemconvConfig;
}
/**
 * Configure general sanitization options.
 * If omitted, defaults as described in ExperimentalSanitization are used.
 */
export interface ExperimentalSanitization {
    url?: ExperimentalUrlSanitization;
}
/**
 * Configure URL sanitization options.
 * If omitted, defaults as described in ExperimentalUrlSanitization are used.
 */
export interface ExperimentalUrlSanitization {
    /**
     * List of query parameter names whose values should be redacted from URLs.
     * Query parameter names are case-sensitive.
     * This is a full override of the default sensitive query parameter keys, it is not a list of keys in addition to the defaults.
     * Set to an empty array to disable query parameter redaction.
     * If omitted, the default sensitive query parameter list as defined by the url semantic conventions (https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/url.md) is used.
     *
     * @minItems 0
     */
    sensitive_query_parameters?: string[];
}
/**
 * Configure C++ language-specific instrumentation libraries.
 * If omitted, instrumentation defaults are used.
 */
export interface ExperimentalLanguageSpecificInstrumentation {
    [k: string]: object;
}
/**
 * Defines configuration parameters specific to a particular OpenTelemetry distribution or vendor.
 * This section provides a standardized location for distribution-specific settings
 * that are not part of the OpenTelemetry configuration model.
 * It allows vendors to expose their own extensions and general configuration options.
 * If omitted, distribution defaults are used.
 */
export interface Distribution {
    [k: string]: object;
}
//# sourceMappingURL=types.d.ts.map