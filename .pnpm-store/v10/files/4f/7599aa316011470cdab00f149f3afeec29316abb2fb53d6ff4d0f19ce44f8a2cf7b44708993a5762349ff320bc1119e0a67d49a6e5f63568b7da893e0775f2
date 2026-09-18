// AUTO-GENERATED — do not edit
// Pre-compiled ajv validator for the OpenTelemetry configuration schema
// Generated from opentelemetry-configuration.git v1.1.0
// Run `npm run generate:config` to regenerate
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
module.exports = validate20;
module.exports.default = validate20;
const schema31 = { "$schema": "https://json-schema.org/draft/2020-12/schema", "title": "OpenTelemetryConfiguration", "type": "object", "additionalProperties": true, "properties": { "file_format": { "type": "string", "description": "The file format version.\nRepresented as a string including the semver major, minor version numbers (and optionally the meta tag). For example: \"0.4\", \"1.0-rc.2\", \"1.0\" (after stable release).\nSee https://github.com/open-telemetry/opentelemetry-configuration/blob/main/VERSIONING.md for more details.\nThe yaml format is documented at https://github.com/open-telemetry/opentelemetry-configuration/tree/main/schema\nProperty is required and must be non-null.\n" }, "disabled": { "type": ["boolean", "null"], "description": "Configure if the SDK is disabled or not.\nIf omitted or null, false is used.\n" }, "log_level": { "$ref": "#/$defs/SeverityNumber", "description": "Configure the log level of the internal logger used by the SDK.\nValues include:\n* debug: debug, severity number 5.\n* debug2: debug2, severity number 6.\n* debug3: debug3, severity number 7.\n* debug4: debug4, severity number 8.\n* error: error, severity number 17.\n* error2: error2, severity number 18.\n* error3: error3, severity number 19.\n* error4: error4, severity number 20.\n* fatal: fatal, severity number 21.\n* fatal2: fatal2, severity number 22.\n* fatal3: fatal3, severity number 23.\n* fatal4: fatal4, severity number 24.\n* info: info, severity number 9.\n* info2: info2, severity number 10.\n* info3: info3, severity number 11.\n* info4: info4, severity number 12.\n* trace: trace, severity number 1.\n* trace2: trace2, severity number 2.\n* trace3: trace3, severity number 3.\n* trace4: trace4, severity number 4.\n* warn: warn, severity number 13.\n* warn2: warn2, severity number 14.\n* warn3: warn3, severity number 15.\n* warn4: warn4, severity number 16.\nIf omitted, INFO is used.\n" }, "attribute_limits": { "$ref": "#/$defs/AttributeLimits", "description": "Configure general attribute limits. See also tracer_provider.limits, logger_provider.limits.\nIf omitted, default values as described in AttributeLimits are used.\n" }, "logger_provider": { "$ref": "#/$defs/LoggerProvider", "description": "Configure logger provider.\nIf omitted, a noop logger provider is used.\n" }, "meter_provider": { "$ref": "#/$defs/MeterProvider", "description": "Configure meter provider.\nIf omitted, a noop meter provider is used.\n" }, "propagator": { "$ref": "#/$defs/Propagator", "description": "Configure text map context propagators.\nIf omitted, a noop propagator is used.\n" }, "tracer_provider": { "$ref": "#/$defs/TracerProvider", "description": "Configure tracer provider.\nIf omitted, a noop tracer provider is used.\n" }, "resource": { "$ref": "#/$defs/Resource", "description": "Configure resource for all signals.\nIf omitted, the default resource is used.\n" }, "instrumentation/development": { "$ref": "#/$defs/ExperimentalInstrumentation", "description": "Configure instrumentation.\nIf omitted, instrumentation defaults are used.\n" }, "distribution": { "$ref": "#/$defs/Distribution", "description": "Defines configuration parameters specific to a particular OpenTelemetry distribution or vendor.\nThis section provides a standardized location for distribution-specific settings\nthat are not part of the OpenTelemetry configuration model.\nIt allows vendors to expose their own extensions and general configuration options.\nIf omitted, distribution defaults are used.\n" } }, "required": ["file_format"], "$defs": { "Aggregation": { "type": "object", "additionalProperties": false, "minProperties": 1, "maxProperties": 1, "properties": { "default": { "$ref": "#/$defs/DefaultAggregation", "description": "Configures the stream to use the instrument kind to select an aggregation and advisory parameters to influence aggregation configuration parameters. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#default-aggregation for details.\nIf omitted, ignore.\n" }, "drop": { "$ref": "#/$defs/DropAggregation", "description": "Configures the stream to ignore/drop all instrument measurements. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#drop-aggregation for details.\nIf omitted, ignore.\n" }, "explicit_bucket_histogram": { "$ref": "#/$defs/ExplicitBucketHistogramAggregation", "description": "Configures the stream to collect data for the histogram metric point using a set of explicit boundary values for histogram bucketing. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#explicit-bucket-histogram-aggregation for details\nIf omitted, ignore.\n" }, "base2_exponential_bucket_histogram": { "$ref": "#/$defs/Base2ExponentialBucketHistogramAggregation", "description": "Configures the stream to collect data for the exponential histogram metric point, which uses a base-2 exponential formula to determine bucket boundaries and an integer scale parameter to control resolution. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#base2-exponential-bucket-histogram-aggregation for details.\nIf omitted, ignore.\n" }, "last_value": { "$ref": "#/$defs/LastValueAggregation", "description": "Configures the stream to collect data using the last measurement. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#last-value-aggregation for details.\nIf omitted, ignore.\n" }, "sum": { "$ref": "#/$defs/SumAggregation", "description": "Configures the stream to collect the arithmetic sum of measurement values. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#sum-aggregation for details.\nIf omitted, ignore.\n" } } }, "AlwaysOffSampler": { "type": ["object", "null"], "additionalProperties": false }, "AlwaysOnSampler": { "type": ["object", "null"], "additionalProperties": false }, "AttributeLimits": { "type": "object", "additionalProperties": false, "properties": { "attribute_value_length_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute value size. \nValue must be non-negative.\nIf omitted or null, there is no limit.\n" }, "attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute count. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" } } }, "AttributeNameValue": { "type": "object", "additionalProperties": false, "properties": { "name": { "type": "string", "description": "The attribute name.\nProperty is required and must be non-null.\n" }, "value": { "oneOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }, { "type": "null" }, { "type": "array", "items": { "type": "string" }, "minItems": 1 }, { "type": "array", "items": { "type": "boolean" }, "minItems": 1 }, { "type": "array", "items": { "type": "number" }, "minItems": 1 }], "description": "The attribute value.\nThe type of value must match .type.\nProperty must be present, but if null the entry is ignored.\n" }, "type": { "$ref": "#/$defs/AttributeType", "description": "The attribute type.\nValues include:\n* bool: Boolean attribute value.\n* bool_array: Boolean array attribute value.\n* double: Double attribute value.\n* double_array: Double array attribute value.\n* int: Integer attribute value.\n* int_array: Integer array attribute value.\n* string: String attribute value.\n* string_array: String array attribute value.\nIf omitted, string is used.\n" } }, "required": ["name", "value"] }, "AttributeType": { "type": ["string", "null"], "enum": ["string", "bool", "int", "double", "string_array", "bool_array", "int_array", "double_array"] }, "B3MultiPropagator": { "type": ["object", "null"], "additionalProperties": false }, "B3Propagator": { "type": ["object", "null"], "additionalProperties": false }, "BaggagePropagator": { "type": ["object", "null"], "additionalProperties": false }, "Base2ExponentialBucketHistogramAggregation": { "type": ["object", "null"], "additionalProperties": false, "properties": { "max_scale": { "type": ["integer", "null"], "minimum": -10, "maximum": 20, "description": "Configure the max scale factor.\nIf omitted or null, 20 is used.\n" }, "max_size": { "type": ["integer", "null"], "minimum": 2, "description": "Configure the maximum number of buckets in each of the positive and negative ranges, not counting the special zero bucket.\nIf omitted or null, 160 is used.\n" }, "record_min_max": { "type": ["boolean", "null"], "description": "Configure whether or not to record min and max.\nIf omitted or null, true is used.\n" } } }, "BatchLogRecordProcessor": { "type": "object", "additionalProperties": false, "properties": { "schedule_delay": { "type": ["integer", "null"], "minimum": 0, "description": "Configure delay interval (in milliseconds) between two consecutive exports. \nValue must be non-negative.\nIf omitted or null, 1000 is used.\n" }, "export_timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure maximum allowed time (in milliseconds) to export data. \nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 30000 is used.\n" }, "max_queue_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum queue size. Value must be positive.\nIf omitted or null, 2048 is used.\n" }, "max_export_batch_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum batch size. Value must be positive.\nIf omitted or null, 512 is used.\n" }, "exporter": { "$ref": "#/$defs/LogRecordExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] }, "BatchSpanProcessor": { "type": "object", "additionalProperties": false, "properties": { "schedule_delay": { "type": ["integer", "null"], "minimum": 0, "description": "Configure delay interval (in milliseconds) between two consecutive exports. \nValue must be non-negative.\nIf omitted or null, 5000 is used.\n" }, "export_timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure maximum allowed time (in milliseconds) to export data. \nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 30000 is used.\n" }, "max_queue_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum queue size. Value must be positive.\nIf omitted or null, 2048 is used.\n" }, "max_export_batch_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum batch size. Value must be positive.\nIf omitted or null, 512 is used.\n" }, "exporter": { "$ref": "#/$defs/SpanExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] }, "CardinalityLimits": { "type": "object", "additionalProperties": false, "properties": { "default": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for all instrument types.\nInstrument-specific cardinality limits take priority.\nIf omitted or null, 2000 is used.\n" }, "counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for counter instruments.\nIf omitted or null, the value from .default is used.\n" }, "gauge": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for gauge instruments.\nIf omitted or null, the value from .default is used.\n" }, "histogram": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for histogram instruments.\nIf omitted or null, the value from .default is used.\n" }, "observable_counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for observable_counter instruments.\nIf omitted or null, the value from .default is used.\n" }, "observable_gauge": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for observable_gauge instruments.\nIf omitted or null, the value from .default is used.\n" }, "observable_up_down_counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for observable_up_down_counter instruments.\nIf omitted or null, the value from .default is used.\n" }, "up_down_counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for up_down_counter instruments.\nIf omitted or null, the value from .default is used.\n" } } }, "ConsoleExporter": { "type": ["object", "null"], "additionalProperties": false }, "ConsoleMetricExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } }, "DefaultAggregation": { "type": ["object", "null"], "additionalProperties": false }, "Distribution": { "type": "object", "additionalProperties": { "type": "object" }, "minProperties": 1 }, "DropAggregation": { "type": ["object", "null"], "additionalProperties": false }, "ExemplarFilter": { "type": ["string", "null"], "enum": ["always_on", "always_off", "trace_based"] }, "ExperimentalCodeInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure code semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee code semantic conventions: https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } }, "ExperimentalComposableAlwaysOffSampler": { "type": ["object", "null"], "additionalProperties": false }, "ExperimentalComposableAlwaysOnSampler": { "type": ["object", "null"], "additionalProperties": false }, "ExperimentalComposableParentThresholdSampler": { "type": ["object"], "additionalProperties": false, "properties": { "root": { "$ref": "#/$defs/ExperimentalComposableSampler", "description": "Sampler to use when there is no parent.\nProperty is required and must be non-null.\n" } }, "required": ["root"] }, "ExperimentalComposableProbabilitySampler": { "type": ["object", "null"], "additionalProperties": false, "properties": { "ratio": { "type": ["number", "null"], "minimum": 0, "maximum": 1, "description": "Configure ratio.\nIf omitted or null, 1.0 is used.\n" } } }, "ExperimentalComposableRuleBasedSampler": { "type": ["object", "null"], "additionalProperties": false, "properties": { "rules": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSamplerRule" }, "description": "The rules for the sampler, matched in order.\nEach rule can have multiple match conditions. All conditions must match for the rule to match.\nIf no conditions are specified, the rule matches all spans that reach it.\nIf no rules match, the span is not sampled.\nIf omitted, no span is sampled.\n" } } }, "ExperimentalComposableRuleBasedSamplerRule": { "type": "object", "description": "A rule for ExperimentalComposableRuleBasedSampler. A rule can have multiple match conditions - the sampler will be applied if all match. \nIf no conditions are specified, the rule matches all spans that reach it.\n", "additionalProperties": false, "properties": { "attribute_values": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues", "description": "Values to match against a single attribute. Non-string attributes are matched using their string representation:\nfor example, a value of \"404\" would match the http.response.status_code 404. For array attributes, if any\nitem matches, it is considered a match.\nIf omitted, ignore.\n" }, "attribute_patterns": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns", "description": "Patterns to match against a single attribute. Non-string attributes are matched using their string representation:\nfor example, a pattern of \"4*\" would match any http.response.status_code in 400-499. For array attributes, if any\nitem matches, it is considered a match.\nIf omitted, ignore.\n" }, "span_kinds": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/SpanKind" }, "description": "The span kinds to match. If the span's kind matches any of these, it matches.\nValues include:\n* client: client, a client span.\n* consumer: consumer, a consumer span.\n* internal: internal, an internal span.\n* producer: producer, a producer span.\n* server: server, a server span.\nIf omitted, ignore.\n" }, "parent": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalSpanParent" }, "description": "The parent span types to match.\nValues include:\n* local: local, a local parent.\n* none: none, no parent, i.e., the trace root.\n* remote: remote, a remote parent.\nIf omitted, ignore.\n" }, "sampler": { "$ref": "#/$defs/ExperimentalComposableSampler", "description": "The sampler to use for matching spans.\nProperty is required and must be non-null.\n" } }, "required": ["sampler"] }, "ExperimentalComposableRuleBasedSamplerRuleAttributePatterns": { "type": "object", "additionalProperties": false, "properties": { "key": { "type": "string", "description": "The attribute key to match against.\nProperty is required and must be non-null.\n" }, "included": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to include.\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, all values are included.\n" }, "excluded": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to exclude. Applies after .included (i.e. excluded has higher priority than included).\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, .included attributes are included.\n" } }, "required": ["key"] }, "ExperimentalComposableRuleBasedSamplerRuleAttributeValues": { "type": "object", "additionalProperties": false, "properties": { "key": { "type": "string", "description": "The attribute key to match against.\nProperty is required and must be non-null.\n" }, "values": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "The attribute values to match against. If the attribute's value matches any of these, it matches.\nProperty is required and must be non-null.\n" } }, "required": ["key", "values"] }, "ExperimentalComposableSampler": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "always_off": { "$ref": "#/$defs/ExperimentalComposableAlwaysOffSampler", "description": "Configure sampler to be always_off.\nIf omitted, ignore.\n" }, "always_on": { "$ref": "#/$defs/ExperimentalComposableAlwaysOnSampler", "description": "Configure sampler to be always_on.\nIf omitted, ignore.\n" }, "parent_threshold": { "$ref": "#/$defs/ExperimentalComposableParentThresholdSampler", "description": "Configure sampler to be parent_threshold.\nIf omitted, ignore.\n" }, "probability": { "$ref": "#/$defs/ExperimentalComposableProbabilitySampler", "description": "Configure sampler to be probability.\nIf omitted, ignore.\n" }, "rule_based": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSampler", "description": "Configure sampler to be rule_based.\nIf omitted, ignore.\n" } } }, "ExperimentalContainerResourceDetector": { "type": ["object", "null"], "additionalProperties": false }, "ExperimentalDbInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure database semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee database migration: https://opentelemetry.io/docs/specs/semconv/database/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } }, "ExperimentalEventToSpanEventBridgeLogRecordProcessor": { "type": ["object", "null"], "additionalProperties": false }, "ExperimentalGenAiInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure GenAI semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } }, "ExperimentalGeneralInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "http": { "$ref": "#/$defs/ExperimentalHttpInstrumentation", "description": "Configure instrumentations following the http semantic conventions.\nSee http semantic conventions: https://opentelemetry.io/docs/specs/semconv/http/\nIf omitted, defaults as described in ExperimentalHttpInstrumentation are used.\n" }, "code": { "$ref": "#/$defs/ExperimentalCodeInstrumentation", "description": "Configure instrumentations following the code semantic conventions.\nSee code semantic conventions: https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/\nIf omitted, defaults as described in ExperimentalCodeInstrumentation are used.\n" }, "db": { "$ref": "#/$defs/ExperimentalDbInstrumentation", "description": "Configure instrumentations following the database semantic conventions.\nSee database semantic conventions: https://opentelemetry.io/docs/specs/semconv/database/\nIf omitted, defaults as described in ExperimentalDbInstrumentation are used.\n" }, "gen_ai": { "$ref": "#/$defs/ExperimentalGenAiInstrumentation", "description": "Configure instrumentations following the GenAI semantic conventions.\nSee GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/\nIf omitted, defaults as described in ExperimentalGenAiInstrumentation are used.\n" }, "messaging": { "$ref": "#/$defs/ExperimentalMessagingInstrumentation", "description": "Configure instrumentations following the messaging semantic conventions.\nSee messaging semantic conventions: https://opentelemetry.io/docs/specs/semconv/messaging/\nIf omitted, defaults as described in ExperimentalMessagingInstrumentation are used.\n" }, "rpc": { "$ref": "#/$defs/ExperimentalRpcInstrumentation", "description": "Configure instrumentations following the RPC semantic conventions.\nSee RPC semantic conventions: https://opentelemetry.io/docs/specs/semconv/rpc/\nIf omitted, defaults as described in ExperimentalRpcInstrumentation are used.\n" }, "sanitization": { "$ref": "#/$defs/ExperimentalSanitization", "description": "Configure general sanitization options.\nIf omitted, defaults as described in ExperimentalSanitization are used.\n" }, "stability_opt_in_list": { "type": ["string", "null"], "description": "Configure semantic convention stability opt-in as a comma-separated list.\nThis property follows the format and semantics of the OTEL_SEMCONV_STABILITY_OPT_IN environment variable.\nControls the emission of stable vs. experimental semantic conventions for instrumentation.\nThis setting is only intended for migrating from experimental to stable semantic conventions.\n\nKnown values include:\n- http: Emit stable HTTP and networking conventions only\n- http/dup: Emit both old and stable HTTP and networking conventions (for phased migration)\n- database: Emit stable database conventions only\n- database/dup: Emit both old and stable database conventions (for phased migration)\n- rpc: Emit stable RPC conventions only\n- rpc/dup: Emit both experimental and stable RPC conventions (for phased migration)\n- messaging: Emit stable messaging conventions only\n- messaging/dup: Emit both old and stable messaging conventions (for phased migration)\n- code: Emit stable code conventions only\n- code/dup: Emit both old and stable code conventions (for phased migration)\n\nMultiple values can be specified as a comma-separated list (e.g., \"http,database/dup\").\nAdditional signal types may be supported in future versions.\n\nDomain-specific semconv properties (e.g., .instrumentation/development.general.db.semconv) take precedence over this general setting.\n\nSee:\n- HTTP migration: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/\n- Database migration: https://opentelemetry.io/docs/specs/semconv/database/\n- RPC: https://opentelemetry.io/docs/specs/semconv/rpc/\n- Messaging: https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/\nIf omitted or null, no opt-in is configured and instrumentations continue emitting their default semantic convention version.\n" } } }, "ExperimentalHostResourceDetector": { "type": ["object", "null"], "additionalProperties": false }, "ExperimentalHttpClientInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "request_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for outbound http requests.\nIf omitted, no outbound request headers are captured.\n" }, "response_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for inbound http responses.\nIf omitted, no inbound response headers are captured.\n" }, "known_methods": { "type": "array", "minItems": 0, "items": { "type": "string" }, "description": "Override the default list of known HTTP methods.\nKnown methods are case-sensitive.\nThis is a full override of the default known methods, not a list of known methods in addition to the defaults.\nIf omitted, HTTP methods GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH are known.\n" } } }, "ExperimentalHttpInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure HTTP semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee HTTP migration: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" }, "client": { "$ref": "#/$defs/ExperimentalHttpClientInstrumentation", "description": "Configure instrumentations following the http client semantic conventions.\nIf omitted, defaults as described in ExperimentalHttpClientInstrumentation are used.\n" }, "server": { "$ref": "#/$defs/ExperimentalHttpServerInstrumentation", "description": "Configure instrumentations following the http server semantic conventions.\nIf omitted, defaults as described in ExperimentalHttpServerInstrumentation are used.\n" } } }, "ExperimentalHttpServerInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "request_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for inbound http requests.\nIf omitted, no request headers are captured.\n" }, "response_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for outbound http responses.\nIf omitted, no response headers are captures.\n" }, "known_methods": { "type": "array", "minItems": 0, "items": { "type": "string" }, "description": "Override the default list of known HTTP methods.\nKnown methods are case-sensitive.\nThis is a full override of the default known methods, not a list of known methods in addition to the defaults.\nIf omitted, HTTP methods GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH are known.\n" } } }, "ExperimentalInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "general": { "$ref": "#/$defs/ExperimentalGeneralInstrumentation", "description": "Configure general SemConv options that may apply to multiple languages and instrumentations.\nInstrumenation may merge general config options with the language specific configuration at .instrumentation.<language>.\nIf omitted, default values as described in ExperimentalGeneralInstrumentation are used.\n" }, "cpp": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure C++ language-specific instrumentation libraries.\nIf omitted, instrumentation defaults are used.\n" }, "dotnet": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure .NET language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "erlang": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Erlang language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "go": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Go language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "java": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Java language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "js": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure JavaScript language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "php": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure PHP language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "python": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Python language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "ruby": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Ruby language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "rust": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Rust language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "swift": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Swift language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" } } }, "ExperimentalJaegerRemoteSampler": { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string"], "description": "Configure the endpoint of the jaeger remote sampling service.\nProperty is required and must be non-null.\n" }, "interval": { "type": ["integer", "null"], "minimum": 0, "description": "Configure the polling interval (in milliseconds) to fetch from the remote sampling service.\nIf omitted or null, 60000 is used.\n" }, "initial_sampler": { "$ref": "#/$defs/Sampler", "description": "Configure the initial sampler used before first configuration is fetched.\nProperty is required and must be non-null.\n" } }, "required": ["endpoint", "initial_sampler"] }, "ExperimentalLanguageSpecificInstrumentation": { "type": "object", "additionalProperties": { "type": "object" } }, "ExperimentalLoggerConfig": { "type": ["object"], "additionalProperties": false, "properties": { "enabled": { "type": ["boolean", "null"], "description": "Configure if the logger is enabled or not.\nIf omitted or null, true is used.\n" }, "minimum_severity": { "$ref": "#/$defs/SeverityNumber", "description": "Configure severity filtering.\nLog records with an non-zero (i.e. unspecified) severity number which is less than minimum_severity are not processed.\nValues include:\n* debug: debug, severity number 5.\n* debug2: debug2, severity number 6.\n* debug3: debug3, severity number 7.\n* debug4: debug4, severity number 8.\n* error: error, severity number 17.\n* error2: error2, severity number 18.\n* error3: error3, severity number 19.\n* error4: error4, severity number 20.\n* fatal: fatal, severity number 21.\n* fatal2: fatal2, severity number 22.\n* fatal3: fatal3, severity number 23.\n* fatal4: fatal4, severity number 24.\n* info: info, severity number 9.\n* info2: info2, severity number 10.\n* info3: info3, severity number 11.\n* info4: info4, severity number 12.\n* trace: trace, severity number 1.\n* trace2: trace2, severity number 2.\n* trace3: trace3, severity number 3.\n* trace4: trace4, severity number 4.\n* warn: warn, severity number 13.\n* warn2: warn2, severity number 14.\n* warn3: warn3, severity number 15.\n* warn4: warn4, severity number 16.\nIf omitted, severity filtering is not applied.\n" }, "trace_based": { "type": ["boolean", "null"], "description": "Configure trace based filtering.\nIf true, log records associated with unsampled trace contexts traces are not processed. If false, or if a log record is not associated with a trace context, trace based filtering is not applied.\nIf omitted or null, trace based filtering is not applied.\n" } } }, "ExperimentalLoggerConfigurator": { "type": ["object"], "additionalProperties": false, "properties": { "default_config": { "$ref": "#/$defs/ExperimentalLoggerConfig", "description": "Configure the default logger config used there is no matching entry in .logger_configurator/development.loggers.\nIf omitted, unmatched .loggers use default values as described in ExperimentalLoggerConfig.\n" }, "loggers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalLoggerMatcherAndConfig" }, "description": "Configure loggers.\nIf omitted, all loggers use .default_config.\n" } } }, "ExperimentalLoggerMatcherAndConfig": { "type": ["object"], "additionalProperties": false, "properties": { "name": { "type": ["string"], "description": "Configure logger names to match. Matching is case-sensitive, evaluated as follows:\n\n * If the logger name exactly matches.\n * If the logger name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nProperty is required and must be non-null.\n" }, "config": { "$ref": "#/$defs/ExperimentalLoggerConfig", "description": "The logger config.\nProperty is required and must be non-null.\n" } }, "required": ["name", "config"] }, "ExperimentalMessagingInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure messaging semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee messaging semantic conventions: https://opentelemetry.io/docs/specs/semconv/messaging/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } }, "ExperimentalMeterConfig": { "type": ["object"], "additionalProperties": false, "properties": { "enabled": { "type": ["boolean"], "description": "Configure if the meter is enabled or not.\nIf omitted, true is used.\n" } } }, "ExperimentalMeterConfigurator": { "type": ["object"], "additionalProperties": false, "properties": { "default_config": { "$ref": "#/$defs/ExperimentalMeterConfig", "description": "Configure the default meter config used there is no matching entry in .meter_configurator/development.meters.\nIf omitted, unmatched .meters use default values as described in ExperimentalMeterConfig.\n" }, "meters": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalMeterMatcherAndConfig" }, "description": "Configure meters.\nIf omitted, all meters used .default_config.\n" } } }, "ExperimentalMeterMatcherAndConfig": { "type": ["object"], "additionalProperties": false, "properties": { "name": { "type": ["string"], "description": "Configure meter names to match. Matching is case-sensitive, evaluated as follows:\n\n * If the meter name exactly matches.\n * If the meter name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nProperty is required and must be non-null.\n" }, "config": { "$ref": "#/$defs/ExperimentalMeterConfig", "description": "The meter config.\nProperty is required and must be non-null.\n" } }, "required": ["name", "config"] }, "ExperimentalOtlpFileExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "output_stream": { "type": ["string", "null"], "description": "Configure output stream. \nValues include stdout, or scheme+destination. For example: file:///path/to/file.jsonl.\nIf omitted or null, stdout is used.\n" } } }, "ExperimentalOtlpFileMetricExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "output_stream": { "type": ["string", "null"], "description": "Configure output stream. \nValues include stdout, or scheme+destination. For example: file:///path/to/file.jsonl.\nIf omitted or null, stdout is used.\n" }, "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } }, "ExperimentalProbabilitySampler": { "type": ["object", "null"], "additionalProperties": false, "properties": { "ratio": { "type": ["number", "null"], "minimum": 0, "maximum": 1, "description": "Configure ratio.\nIf omitted or null, 1.0 is used.\n" } } }, "ExperimentalProcessResourceDetector": { "type": ["object", "null"], "additionalProperties": false }, "ExperimentalPrometheusMetricExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "host": { "type": ["string", "null"], "description": "Configure host.\nIf omitted or null, localhost is used.\n" }, "port": { "type": ["integer", "null"], "description": "Configure port.\nIf omitted or null, 9464 is used.\n" }, "scope_info_enabled": { "type": ["boolean", "null"], "description": "Configure Prometheus Exporter to produce metrics with scope labels.\nIf omitted or null, true is used.\n" }, "target_info_enabled/development": { "type": ["boolean", "null"], "description": "Configure Prometheus Exporter to produce metrics with a target info metric for the resource.\nIf omitted or null, true is used.\n" }, "resource_constant_labels": { "$ref": "#/$defs/IncludeExclude", "description": "Configure Prometheus Exporter to add resource attributes as metrics attributes, where the resource attribute keys match the patterns.\nIf omitted, no resource attributes are added.\n" }, "translation_strategy": { "$ref": "#/$defs/ExperimentalPrometheusTranslationStrategy", "description": "Configure how metric names are translated to Prometheus metric names.\nValues include:\n* no_translation/development: Special character escaping is disabled. Type and unit suffixes are disabled. Metric names are unaltered.\n* no_utf8_escaping_with_suffixes/development: Special character escaping is disabled. Type and unit suffixes are enabled.\n* underscore_escaping_with_suffixes: Special character escaping is enabled. Type and unit suffixes are enabled.\n* underscore_escaping_without_suffixes/development: Special character escaping is enabled. Type and unit suffixes are disabled. This represents classic Prometheus metric name compatibility.\nIf omitted, underscore_escaping_with_suffixes is used.\n" } } }, "ExperimentalPrometheusTranslationStrategy": { "type": ["string", "null"], "enum": ["underscore_escaping_with_suffixes", "underscore_escaping_without_suffixes/development", "no_utf8_escaping_with_suffixes/development", "no_translation/development"] }, "ExperimentalResourceDetection": { "type": "object", "additionalProperties": false, "properties": { "attributes": { "$ref": "#/$defs/IncludeExclude", "description": "Configure attributes provided by resource detectors.\nIf omitted, all attributes from resource detectors are added.\n" }, "detectors": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalResourceDetector" }, "description": "Configure resource detectors.\nResource detector names are dependent on the SDK language ecosystem. Please consult documentation for each respective language. \nIf omitted, no resource detectors are enabled.\n" } } }, "ExperimentalResourceDetector": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "container": { "$ref": "#/$defs/ExperimentalContainerResourceDetector", "description": "Enable the container resource detector, which populates container.* attributes.\nIf omitted, ignore.\n" }, "host": { "$ref": "#/$defs/ExperimentalHostResourceDetector", "description": "Enable the host resource detector, which populates host.* and os.* attributes.\nIf omitted, ignore.\n" }, "process": { "$ref": "#/$defs/ExperimentalProcessResourceDetector", "description": "Enable the process resource detector, which populates process.* attributes.\nIf omitted, ignore.\n" }, "service": { "$ref": "#/$defs/ExperimentalServiceResourceDetector", "description": "Enable the service detector, which populates service.name based on the OTEL_SERVICE_NAME environment variable and service.instance.id.\nIf omitted, ignore.\n" } } }, "ExperimentalRpcInstrumentation": { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure RPC semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee RPC semantic conventions: https://opentelemetry.io/docs/specs/semconv/rpc/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } }, "ExperimentalSanitization": { "type": "object", "additionalProperties": false, "properties": { "url": { "$ref": "#/$defs/ExperimentalUrlSanitization", "description": "Configure URL sanitization options.\nIf omitted, defaults as described in ExperimentalUrlSanitization are used.\n" } } }, "ExperimentalSemconvConfig": { "type": "object", "additionalProperties": false, "properties": { "version": { "type": ["integer", "null"], "minimum": 0, "description": "The target semantic convention version for this domain (e.g., 1).\nIf omitted or null, the latest stable version is used, or if no stable version is available and .experimental is true then the latest experimental version is used.\n" }, "experimental": { "type": ["boolean", "null"], "description": "Use latest experimental semantic conventions (before stable is available or to enable experimental features on top of stable conventions).\nIf omitted or null, false is used.\n" }, "dual_emit": { "type": ["boolean", "null"], "description": "When true, also emit the previous major version alongside the target version.\nFor version=1, the previous version refers to the pre-stable conventions that the instrumentation emitted before the first stable semantic convention version was defined.\nFor version=2 and above, the previous version is the prior stable major version (e.g., version=2, dual_emit=true emits both v2 and v1).\nEnables dual-emit for phased migration between versions.\nIf omitted or null, false is used.\n" } } }, "ExperimentalServiceResourceDetector": { "type": ["object", "null"], "additionalProperties": false }, "ExperimentalSpanParent": { "type": ["string", "null"], "enum": ["none", "remote", "local"] }, "ExperimentalTracerConfig": { "type": ["object"], "additionalProperties": false, "properties": { "enabled": { "type": ["boolean"], "description": "Configure if the tracer is enabled or not.\nIf omitted, true is used.\n" } } }, "ExperimentalTracerConfigurator": { "type": ["object"], "additionalProperties": false, "properties": { "default_config": { "$ref": "#/$defs/ExperimentalTracerConfig", "description": "Configure the default tracer config used there is no matching entry in .tracer_configurator/development.tracers.\nIf omitted, unmatched .tracers use default values as described in ExperimentalTracerConfig.\n" }, "tracers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalTracerMatcherAndConfig" }, "description": "Configure tracers.\nIf omitted, all tracers use .default_config.\n" } } }, "ExperimentalTracerMatcherAndConfig": { "type": ["object"], "additionalProperties": false, "properties": { "name": { "type": ["string"], "description": "Configure tracer names to match. Matching is case-sensitive, evaluated as follows:\n\n * If the tracer name exactly matches.\n * If the tracer name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nProperty is required and must be non-null.\n" }, "config": { "$ref": "#/$defs/ExperimentalTracerConfig", "description": "The tracer config.\nProperty is required and must be non-null.\n" } }, "required": ["name", "config"] }, "ExperimentalUrlSanitization": { "type": "object", "additionalProperties": false, "properties": { "sensitive_query_parameters": { "type": "array", "minItems": 0, "items": { "type": "string" }, "description": "List of query parameter names whose values should be redacted from URLs.\nQuery parameter names are case-sensitive.\nThis is a full override of the default sensitive query parameter keys, it is not a list of keys in addition to the defaults.\nSet to an empty array to disable query parameter redaction.\nIf omitted, the default sensitive query parameter list as defined by the url semantic conventions (https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/url.md) is used.\n" } } }, "ExplicitBucketHistogramAggregation": { "type": ["object", "null"], "additionalProperties": false, "properties": { "boundaries": { "type": "array", "minItems": 0, "items": { "type": "number" }, "description": "Configure bucket boundaries.\nIf omitted, [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000] is used.\n" }, "record_min_max": { "type": ["boolean", "null"], "description": "Configure record min and max.\nIf omitted or null, true is used.\n" } } }, "ExporterDefaultHistogramAggregation": { "type": ["string", "null"], "enum": ["explicit_bucket_histogram", "base2_exponential_bucket_histogram"] }, "ExporterTemporalityPreference": { "type": ["string", "null"], "enum": ["cumulative", "delta", "low_memory"] }, "GrpcTls": { "type": ["object", "null"], "additionalProperties": false, "properties": { "ca_file": { "type": ["string", "null"], "description": "Configure certificate used to verify a server's TLS credentials. \nAbsolute path to certificate file in PEM format.\nIf omitted or null, system default certificate verification is used for secure connections.\n" }, "key_file": { "type": ["string", "null"], "description": "Configure mTLS private client key. \nAbsolute path to client key file in PEM format. If set, .client_certificate must also be set.\nIf omitted or null, mTLS is not used.\n" }, "cert_file": { "type": ["string", "null"], "description": "Configure mTLS client certificate. \nAbsolute path to client certificate file in PEM format. If set, .client_key must also be set.\nIf omitted or null, mTLS is not used.\n" }, "insecure": { "type": ["boolean", "null"], "description": "Configure client transport security for the exporter's connection. \nOnly applicable when .endpoint is provided without http or https scheme. Implementations may choose to ignore .insecure.\nIf omitted or null, false is used.\n" } } }, "HttpTls": { "type": ["object", "null"], "additionalProperties": false, "properties": { "ca_file": { "type": ["string", "null"], "description": "Configure certificate used to verify a server's TLS credentials. \nAbsolute path to certificate file in PEM format.\nIf omitted or null, system default certificate verification is used for secure connections.\n" }, "key_file": { "type": ["string", "null"], "description": "Configure mTLS private client key. \nAbsolute path to client key file in PEM format. If set, .client_certificate must also be set.\nIf omitted or null, mTLS is not used.\n" }, "cert_file": { "type": ["string", "null"], "description": "Configure mTLS client certificate. \nAbsolute path to client certificate file in PEM format. If set, .client_key must also be set.\nIf omitted or null, mTLS is not used.\n" } } }, "IdGenerator": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "random": { "$ref": "#/$defs/RandomIdGenerator", "description": "Configure the ID generator to randomly generate TraceIds and SpanIds (spec default).\nIf omitted, ignore.\n" } } }, "IncludeExclude": { "type": "object", "additionalProperties": false, "properties": { "included": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to include.\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, all values are included.\n" }, "excluded": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to exclude. Applies after .included (i.e. excluded has higher priority than included).\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, .included attributes are included.\n" } } }, "InstrumentType": { "type": ["string", "null"], "enum": ["counter", "gauge", "histogram", "observable_counter", "observable_gauge", "observable_up_down_counter", "up_down_counter"] }, "LastValueAggregation": { "type": ["object", "null"], "additionalProperties": false }, "LoggerProvider": { "type": "object", "additionalProperties": false, "properties": { "processors": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/LogRecordProcessor" }, "description": "Configure log record processors.\nProperty is required and must be non-null.\n" }, "limits": { "$ref": "#/$defs/LogRecordLimits", "description": "Configure log record limits. See also attribute_limits.\nIf omitted, default values as described in LogRecordLimits are used.\n" }, "logger_configurator/development": { "$ref": "#/$defs/ExperimentalLoggerConfigurator", "description": "Configure loggers.\nIf omitted, all loggers use default values as described in ExperimentalLoggerConfig.\n" } }, "required": ["processors"] }, "LogRecordExporter": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "otlp_http": { "$ref": "#/$defs/OtlpHttpExporter", "description": "Configure exporter to be OTLP with HTTP transport.\nIf omitted, ignore.\n" }, "otlp_grpc": { "$ref": "#/$defs/OtlpGrpcExporter", "description": "Configure exporter to be OTLP with gRPC transport.\nIf omitted, ignore.\n" }, "otlp_file/development": { "$ref": "#/$defs/ExperimentalOtlpFileExporter", "description": "Configure exporter to be OTLP with file transport.\nIf omitted, ignore.\n" }, "console": { "$ref": "#/$defs/ConsoleExporter", "description": "Configure exporter to be console.\nIf omitted, ignore.\n" } } }, "LogRecordLimits": { "type": "object", "additionalProperties": false, "properties": { "attribute_value_length_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute value size. Overrides .attribute_limits.attribute_value_length_limit. \nValue must be non-negative.\nIf omitted or null, there is no limit.\n" }, "attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute count. Overrides .attribute_limits.attribute_count_limit. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" } } }, "LogRecordProcessor": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "batch": { "$ref": "#/$defs/BatchLogRecordProcessor", "description": "Configure a batch log record processor.\nIf omitted, ignore.\n" }, "simple": { "$ref": "#/$defs/SimpleLogRecordProcessor", "description": "Configure a simple log record processor.\nIf omitted, ignore.\n" }, "event_to_span_event_bridge/development": { "$ref": "#/$defs/ExperimentalEventToSpanEventBridgeLogRecordProcessor", "description": "Configure an event to span event bridge log record processor.\nIf omitted, ignore.\n" } } }, "MeterProvider": { "type": "object", "additionalProperties": false, "properties": { "readers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/MetricReader" }, "description": "Configure metric readers.\nProperty is required and must be non-null.\n" }, "views": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/View" }, "description": "Configure views. \nEach view has a selector which determines the instrument(s) it applies to, and a configuration for the resulting stream(s).\nIf omitted, no views are registered.\n" }, "exemplar_filter": { "$ref": "#/$defs/ExemplarFilter", "description": "Configure the exemplar filter.\nValues include:\n* always_off: ExemplarFilter which makes no measurements eligible for being an Exemplar.\n* always_on: ExemplarFilter which makes all measurements eligible for being an Exemplar.\n* trace_based: ExemplarFilter which makes measurements recorded in the context of a sampled parent span eligible for being an Exemplar.\nIf omitted, trace_based is used.\n" }, "meter_configurator/development": { "$ref": "#/$defs/ExperimentalMeterConfigurator", "description": "Configure meters.\nIf omitted, all meters use default values as described in ExperimentalMeterConfig.\n" } }, "required": ["readers"] }, "MetricProducer": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "opencensus": { "$ref": "#/$defs/OpenCensusMetricProducer", "description": "Configure metric producer to be opencensus.\nIf omitted, ignore.\n" } } }, "MetricReader": { "type": "object", "additionalProperties": false, "minProperties": 1, "maxProperties": 1, "properties": { "periodic": { "$ref": "#/$defs/PeriodicMetricReader", "description": "Configure a periodic metric reader.\nIf omitted, ignore.\n" }, "pull": { "$ref": "#/$defs/PullMetricReader", "description": "Configure a pull based metric reader.\nIf omitted, ignore.\n" } } }, "NameStringValuePair": { "type": "object", "additionalProperties": false, "properties": { "name": { "type": "string", "description": "The name of the pair.\nProperty is required and must be non-null.\n" }, "value": { "type": ["string", "null"], "description": "The value of the pair.\nProperty must be present, but if null the behavior is dependent on usage context.\n" } }, "required": ["name", "value"] }, "OpenCensusMetricProducer": { "type": ["object", "null"], "additionalProperties": false }, "OtlpGrpcExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint.\nIf omitted or null, http://localhost:4317 is used.\n" }, "tls": { "$ref": "#/$defs/GrpcTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" } } }, "OtlpGrpcMetricExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint.\nIf omitted or null, http://localhost:4317 is used.\n" }, "tls": { "$ref": "#/$defs/GrpcTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" }, "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } }, "OtlpHttpEncoding": { "type": ["string", "null"], "enum": ["protobuf", "json"] }, "OtlpHttpExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint, including the signal specific path.\nIf omitted or null, the http://localhost:4318/v1/{signal} (where signal is 'traces', 'logs', or 'metrics') is used.\n" }, "tls": { "$ref": "#/$defs/HttpTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" }, "encoding": { "$ref": "#/$defs/OtlpHttpEncoding", "description": "Configure the encoding used for messages. \nImplementations may not support json.\nValues include:\n* json: Protobuf JSON encoding.\n* protobuf: Protobuf binary encoding.\nIf omitted, protobuf is used.\n" } } }, "OtlpHttpMetricExporter": { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint.\nIf omitted or null, http://localhost:4318/v1/metrics is used.\n" }, "tls": { "$ref": "#/$defs/HttpTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" }, "encoding": { "$ref": "#/$defs/OtlpHttpEncoding", "description": "Configure the encoding used for messages. \nImplementations may not support json.\nValues include:\n* json: Protobuf JSON encoding.\n* protobuf: Protobuf binary encoding.\nIf omitted, protobuf is used.\n" }, "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } }, "ParentBasedSampler": { "type": ["object", "null"], "additionalProperties": false, "properties": { "root": { "$ref": "#/$defs/Sampler", "description": "Configure root sampler.\nIf omitted, always_on is used.\n" }, "remote_parent_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure remote_parent_sampled sampler.\nIf omitted, always_on is used.\n" }, "remote_parent_not_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure remote_parent_not_sampled sampler.\nIf omitted, always_off is used.\n" }, "local_parent_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure local_parent_sampled sampler.\nIf omitted, always_on is used.\n" }, "local_parent_not_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure local_parent_not_sampled sampler.\nIf omitted, always_off is used.\n" } } }, "PeriodicMetricReader": { "type": "object", "additionalProperties": false, "properties": { "interval": { "type": ["integer", "null"], "minimum": 0, "description": "Configure delay interval (in milliseconds) between start of two consecutive exports. \nValue must be non-negative.\nIf omitted or null, 60000 is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure maximum allowed time (in milliseconds) to export data. \nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 30000 is used.\n" }, "max_export_batch_size/development": { "type": ["integer", "null"], "minimum": 1, "description": "Configure maximum export batch size.\nIf omitted or null, no limit is used.\n" }, "exporter": { "$ref": "#/$defs/PushMetricExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" }, "producers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/MetricProducer" }, "description": "Configure metric producers.\nIf omitted, no metric producers are added.\n" }, "cardinality_limits": { "$ref": "#/$defs/CardinalityLimits", "description": "Configure cardinality limits.\nIf omitted, default values as described in CardinalityLimits are used.\n" } }, "required": ["exporter"] }, "Propagator": { "type": "object", "additionalProperties": false, "properties": { "composite": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/TextMapPropagator" }, "description": "Configure the propagators in the composite text map propagator. Entries from .composite_list are appended to the list here with duplicates filtered out.\nBuilt-in propagator keys include: tracecontext, baggage, b3, b3multi. Known third party keys include: xray.\nIf omitted, and .composite_list is omitted or null, a noop propagator is used.\n" }, "composite_list": { "type": ["string", "null"], "description": "Configure the propagators in the composite text map propagator. Entries are appended to .composite with duplicates filtered out.\nThe value is a comma separated list of propagator identifiers matching the format of OTEL_PROPAGATORS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/configuration/sdk-environment-variables.md#general-sdk-configuration for details.\nBuilt-in propagator identifiers include: tracecontext, baggage, b3, b3multi. Known third party identifiers include: xray.\nIf omitted or null, and .composite is omitted or null, a noop propagator is used.\n" } } }, "PullMetricExporter": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "prometheus/development": { "$ref": "#/$defs/ExperimentalPrometheusMetricExporter", "description": "Configure exporter to be prometheus.\nIf omitted, ignore.\n" } } }, "PullMetricReader": { "type": "object", "additionalProperties": false, "properties": { "exporter": { "$ref": "#/$defs/PullMetricExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" }, "producers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/MetricProducer" }, "description": "Configure metric producers.\nIf omitted, no metric producers are added.\n" }, "cardinality_limits": { "$ref": "#/$defs/CardinalityLimits", "description": "Configure cardinality limits.\nIf omitted, default values as described in CardinalityLimits are used.\n" } }, "required": ["exporter"] }, "PushMetricExporter": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "otlp_http": { "$ref": "#/$defs/OtlpHttpMetricExporter", "description": "Configure exporter to be OTLP with HTTP transport.\nIf omitted, ignore.\n" }, "otlp_grpc": { "$ref": "#/$defs/OtlpGrpcMetricExporter", "description": "Configure exporter to be OTLP with gRPC transport.\nIf omitted, ignore.\n" }, "otlp_file/development": { "$ref": "#/$defs/ExperimentalOtlpFileMetricExporter", "description": "Configure exporter to be OTLP with file transport.\nIf omitted, ignore.\n" }, "console": { "$ref": "#/$defs/ConsoleMetricExporter", "description": "Configure exporter to be console.\nIf omitted, ignore.\n" } } }, "RandomIdGenerator": { "type": ["object", "null"], "additionalProperties": false }, "Resource": { "type": "object", "additionalProperties": false, "properties": { "attributes": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/AttributeNameValue" }, "description": "Configure resource attributes. Entries have higher priority than entries from .resource.attributes_list.\nIf omitted, no resource attributes are added.\n" }, "detection/development": { "$ref": "#/$defs/ExperimentalResourceDetection", "description": "Configure resource detection.\nIf omitted, resource detection is disabled.\n" }, "schema_url": { "type": ["string", "null"], "description": "Configure resource schema URL.\nIf omitted or null, no schema URL is used.\n" }, "attributes_list": { "type": ["string", "null"], "description": "Configure resource attributes. Entries have lower priority than entries from .resource.attributes.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_RESOURCE_ATTRIBUTES. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/configuration/sdk-environment-variables.md#general-sdk-configuration for details.\nIf omitted or null, no resource attributes are added.\n" } } }, "Sampler": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "always_off": { "$ref": "#/$defs/AlwaysOffSampler", "description": "Configure sampler to be always_off.\nIf omitted, ignore.\n" }, "always_on": { "$ref": "#/$defs/AlwaysOnSampler", "description": "Configure sampler to be always_on.\nIf omitted, ignore.\n" }, "composite/development": { "$ref": "#/$defs/ExperimentalComposableSampler", "description": "Configure sampler to be composite.\nIf omitted, ignore.\n" }, "jaeger_remote/development": { "$ref": "#/$defs/ExperimentalJaegerRemoteSampler", "description": "Configure sampler to be jaeger_remote.\nIf omitted, ignore.\n" }, "parent_based": { "$ref": "#/$defs/ParentBasedSampler", "description": "Configure sampler to be parent_based.\nIf omitted, ignore.\n" }, "probability/development": { "$ref": "#/$defs/ExperimentalProbabilitySampler", "description": "Configure sampler to be probability.\nIf omitted, ignore.\n" }, "trace_id_ratio_based": { "$ref": "#/$defs/TraceIdRatioBasedSampler", "description": "Configure sampler to be trace_id_ratio_based.\nIf omitted, ignore.\n" } } }, "SeverityNumber": { "type": ["string", "null"], "enum": ["trace", "trace2", "trace3", "trace4", "debug", "debug2", "debug3", "debug4", "info", "info2", "info3", "info4", "warn", "warn2", "warn3", "warn4", "error", "error2", "error3", "error4", "fatal", "fatal2", "fatal3", "fatal4"] }, "SimpleLogRecordProcessor": { "type": "object", "additionalProperties": false, "properties": { "exporter": { "$ref": "#/$defs/LogRecordExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] }, "SimpleSpanProcessor": { "type": "object", "additionalProperties": false, "properties": { "exporter": { "$ref": "#/$defs/SpanExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] }, "SpanExporter": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "otlp_http": { "$ref": "#/$defs/OtlpHttpExporter", "description": "Configure exporter to be OTLP with HTTP transport.\nIf omitted, ignore.\n" }, "otlp_grpc": { "$ref": "#/$defs/OtlpGrpcExporter", "description": "Configure exporter to be OTLP with gRPC transport.\nIf omitted, ignore.\n" }, "otlp_file/development": { "$ref": "#/$defs/ExperimentalOtlpFileExporter", "description": "Configure exporter to be OTLP with file transport.\nIf omitted, ignore.\n" }, "console": { "$ref": "#/$defs/ConsoleExporter", "description": "Configure exporter to be console.\nIf omitted, ignore.\n" } } }, "SpanKind": { "type": ["string", "null"], "enum": ["internal", "server", "client", "producer", "consumer"] }, "SpanLimits": { "type": "object", "additionalProperties": false, "properties": { "attribute_value_length_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute value size. Overrides .attribute_limits.attribute_value_length_limit. \nValue must be non-negative.\nIf omitted or null, there is no limit.\n" }, "attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute count. Overrides .attribute_limits.attribute_count_limit. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "event_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max span event count. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "link_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max span link count. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "event_attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attributes per span event. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "link_attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attributes per span link. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" } } }, "SpanProcessor": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "batch": { "$ref": "#/$defs/BatchSpanProcessor", "description": "Configure a batch span processor.\nIf omitted, ignore.\n" }, "simple": { "$ref": "#/$defs/SimpleSpanProcessor", "description": "Configure a simple span processor.\nIf omitted, ignore.\n" } } }, "SumAggregation": { "type": ["object", "null"], "additionalProperties": false }, "TextMapPropagator": { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "tracecontext": { "$ref": "#/$defs/TraceContextPropagator", "description": "Include the w3c trace context propagator.\nIf omitted, ignore.\n" }, "baggage": { "$ref": "#/$defs/BaggagePropagator", "description": "Include the w3c baggage propagator.\nIf omitted, ignore.\n" }, "b3": { "$ref": "#/$defs/B3Propagator", "description": "Include the zipkin b3 propagator.\nIf omitted, ignore.\n" }, "b3multi": { "$ref": "#/$defs/B3MultiPropagator", "description": "Include the zipkin b3 multi propagator.\nIf omitted, ignore.\n" } } }, "TraceContextPropagator": { "type": ["object", "null"], "additionalProperties": false }, "TraceIdRatioBasedSampler": { "type": ["object", "null"], "additionalProperties": false, "properties": { "ratio": { "type": ["number", "null"], "minimum": 0, "maximum": 1, "description": "Configure trace_id_ratio.\nIf omitted or null, 1.0 is used.\n" } } }, "TracerProvider": { "type": "object", "additionalProperties": false, "properties": { "processors": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/SpanProcessor" }, "description": "Configure span processors.\nProperty is required and must be non-null.\n" }, "limits": { "$ref": "#/$defs/SpanLimits", "description": "Configure span limits. See also attribute_limits.\nIf omitted, default values as described in SpanLimits are used.\n" }, "sampler": { "$ref": "#/$defs/Sampler", "description": "Configure the sampler.\nIf omitted, parent based sampler with a root of always_on is used.\n" }, "id_generator": { "$ref": "#/$defs/IdGenerator", "description": "Configure the trace and span ID generator.\nIf omitted, RandomIdGenerator is used.\n" }, "tracer_configurator/development": { "$ref": "#/$defs/ExperimentalTracerConfigurator", "description": "Configure tracers.\nIf omitted, all tracers use default values as described in ExperimentalTracerConfig.\n" } }, "required": ["processors"] }, "View": { "type": "object", "additionalProperties": false, "properties": { "selector": { "$ref": "#/$defs/ViewSelector", "description": "Configure view selector. \nSelection criteria is additive as described in https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#instrument-selection-criteria.\nProperty is required and must be non-null.\n" }, "stream": { "$ref": "#/$defs/ViewStream", "description": "Configure view stream.\nProperty is required and must be non-null.\n" } }, "required": ["selector", "stream"] }, "ViewSelector": { "type": "object", "additionalProperties": false, "properties": { "instrument_name": { "type": ["string", "null"], "description": "Configure instrument name selection criteria.\nIf omitted or null, all instrument names match.\n" }, "instrument_type": { "$ref": "#/$defs/InstrumentType", "description": "Configure instrument type selection criteria.\nValues include:\n* counter: Synchronous counter instruments.\n* gauge: Synchronous gauge instruments.\n* histogram: Synchronous histogram instruments.\n* observable_counter: Asynchronous counter instruments.\n* observable_gauge: Asynchronous gauge instruments.\n* observable_up_down_counter: Asynchronous up down counter instruments.\n* up_down_counter: Synchronous up down counter instruments.\nIf omitted, all instrument types match.\n" }, "unit": { "type": ["string", "null"], "description": "Configure the instrument unit selection criteria.\nIf omitted or null, all instrument units match.\n" }, "meter_name": { "type": ["string", "null"], "description": "Configure meter name selection criteria.\nIf omitted or null, all meter names match.\n" }, "meter_version": { "type": ["string", "null"], "description": "Configure meter version selection criteria.\nIf omitted or null, all meter versions match.\n" }, "meter_schema_url": { "type": ["string", "null"], "description": "Configure meter schema url selection criteria.\nIf omitted or null, all meter schema URLs match.\n" } } }, "ViewStream": { "type": "object", "additionalProperties": false, "properties": { "name": { "type": ["string", "null"], "description": "Configure metric name of the resulting stream(s).\nIf omitted or null, the instrument's original name is used.\n" }, "description": { "type": ["string", "null"], "description": "Configure metric description of the resulting stream(s).\nIf omitted or null, the instrument's origin description is used.\n" }, "aggregation": { "$ref": "#/$defs/Aggregation", "description": "Configure aggregation of the resulting stream(s).\nIf omitted, default is used.\n" }, "aggregation_cardinality_limit": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure the aggregation cardinality limit.\nIf omitted or null, the metric reader's default cardinality limit is used.\n" }, "attribute_keys": { "$ref": "#/$defs/IncludeExclude", "description": "Configure attribute keys retained in the resulting stream(s).\nIf omitted, all attribute keys are retained.\n" } } } } };
const schema32 = { "type": ["string", "null"], "enum": ["trace", "trace2", "trace3", "trace4", "debug", "debug2", "debug3", "debug4", "info", "info2", "info3", "info4", "warn", "warn2", "warn3", "warn4", "error", "error2", "error3", "error4", "fatal", "fatal2", "fatal3", "fatal4"] };
const schema33 = { "type": "object", "additionalProperties": false, "properties": { "attribute_value_length_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute value size. \nValue must be non-negative.\nIf omitted or null, there is no limit.\n" }, "attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute count. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" } } };
const schema178 = { "type": "object", "additionalProperties": { "type": "object" }, "minProperties": 1 };
const schema34 = { "type": "object", "additionalProperties": false, "properties": { "processors": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/LogRecordProcessor" }, "description": "Configure log record processors.\nProperty is required and must be non-null.\n" }, "limits": { "$ref": "#/$defs/LogRecordLimits", "description": "Configure log record limits. See also attribute_limits.\nIf omitted, default values as described in LogRecordLimits are used.\n" }, "logger_configurator/development": { "$ref": "#/$defs/ExperimentalLoggerConfigurator", "description": "Configure loggers.\nIf omitted, all loggers use default values as described in ExperimentalLoggerConfig.\n" } }, "required": ["processors"] };
const schema49 = { "type": "object", "additionalProperties": false, "properties": { "attribute_value_length_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute value size. Overrides .attribute_limits.attribute_value_length_limit. \nValue must be non-negative.\nIf omitted or null, there is no limit.\n" }, "attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute count. Overrides .attribute_limits.attribute_count_limit. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" } } };
const schema35 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "batch": { "$ref": "#/$defs/BatchLogRecordProcessor", "description": "Configure a batch log record processor.\nIf omitted, ignore.\n" }, "simple": { "$ref": "#/$defs/SimpleLogRecordProcessor", "description": "Configure a simple log record processor.\nIf omitted, ignore.\n" }, "event_to_span_event_bridge/development": { "$ref": "#/$defs/ExperimentalEventToSpanEventBridgeLogRecordProcessor", "description": "Configure an event to span event bridge log record processor.\nIf omitted, ignore.\n" } } };
const schema48 = { "type": ["object", "null"], "additionalProperties": false };
const schema36 = { "type": "object", "additionalProperties": false, "properties": { "schedule_delay": { "type": ["integer", "null"], "minimum": 0, "description": "Configure delay interval (in milliseconds) between two consecutive exports. \nValue must be non-negative.\nIf omitted or null, 1000 is used.\n" }, "export_timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure maximum allowed time (in milliseconds) to export data. \nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 30000 is used.\n" }, "max_queue_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum queue size. Value must be positive.\nIf omitted or null, 2048 is used.\n" }, "max_export_batch_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum batch size. Value must be positive.\nIf omitted or null, 512 is used.\n" }, "exporter": { "$ref": "#/$defs/LogRecordExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] };
const schema37 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "otlp_http": { "$ref": "#/$defs/OtlpHttpExporter", "description": "Configure exporter to be OTLP with HTTP transport.\nIf omitted, ignore.\n" }, "otlp_grpc": { "$ref": "#/$defs/OtlpGrpcExporter", "description": "Configure exporter to be OTLP with gRPC transport.\nIf omitted, ignore.\n" }, "otlp_file/development": { "$ref": "#/$defs/ExperimentalOtlpFileExporter", "description": "Configure exporter to be OTLP with file transport.\nIf omitted, ignore.\n" }, "console": { "$ref": "#/$defs/ConsoleExporter", "description": "Configure exporter to be console.\nIf omitted, ignore.\n" } } };
const schema45 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "output_stream": { "type": ["string", "null"], "description": "Configure output stream. \nValues include stdout, or scheme+destination. For example: file:///path/to/file.jsonl.\nIf omitted or null, stdout is used.\n" } } };
const schema46 = { "type": ["object", "null"], "additionalProperties": false };
const schema38 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint, including the signal specific path.\nIf omitted or null, the http://localhost:4318/v1/{signal} (where signal is 'traces', 'logs', or 'metrics') is used.\n" }, "tls": { "$ref": "#/$defs/HttpTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" }, "encoding": { "$ref": "#/$defs/OtlpHttpEncoding", "description": "Configure the encoding used for messages. \nImplementations may not support json.\nValues include:\n* json: Protobuf JSON encoding.\n* protobuf: Protobuf binary encoding.\nIf omitted, protobuf is used.\n" } } };
const schema39 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "ca_file": { "type": ["string", "null"], "description": "Configure certificate used to verify a server's TLS credentials. \nAbsolute path to certificate file in PEM format.\nIf omitted or null, system default certificate verification is used for secure connections.\n" }, "key_file": { "type": ["string", "null"], "description": "Configure mTLS private client key. \nAbsolute path to client key file in PEM format. If set, .client_certificate must also be set.\nIf omitted or null, mTLS is not used.\n" }, "cert_file": { "type": ["string", "null"], "description": "Configure mTLS client certificate. \nAbsolute path to client certificate file in PEM format. If set, .client_key must also be set.\nIf omitted or null, mTLS is not used.\n" } } };
const schema40 = { "type": "object", "additionalProperties": false, "properties": { "name": { "type": "string", "description": "The name of the pair.\nProperty is required and must be non-null.\n" }, "value": { "type": ["string", "null"], "description": "The value of the pair.\nProperty must be present, but if null the behavior is dependent on usage context.\n" } }, "required": ["name", "value"] };
const schema41 = { "type": ["string", "null"], "enum": ["protobuf", "json"] };
function validate25(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate25.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate25.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema38.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(((((((key0 === "endpoint") || (key0 === "tls")) || (key0 === "headers")) || (key0 === "headers_list")) || (key0 === "compression")) || (key0 === "timeout")) || (key0 === "encoding"))) {
                validate25.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.endpoint !== undefined) {
                let data0 = data.endpoint;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate25.errors = [{ instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/type", keyword: "type", params: { type: schema38.properties.endpoint.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.tls !== undefined) {
                    let data1 = data.tls;
                    const _errs4 = errors;
                    const _errs5 = errors;
                    if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                        validate25.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/HttpTls/type", keyword: "type", params: { type: schema39.type }, message: "must be object,null" }];
                        return false;
                    }
                    if (errors === _errs5) {
                        if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                            const _errs7 = errors;
                            for (const key1 in data1) {
                                if (!(((key1 === "ca_file") || (key1 === "key_file")) || (key1 === "cert_file"))) {
                                    validate25.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/HttpTls/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                            if (_errs7 === errors) {
                                if (data1.ca_file !== undefined) {
                                    let data2 = data1.ca_file;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "string") && (data2 !== null)) {
                                        validate25.errors = [{ instancePath: instancePath + "/tls/ca_file", schemaPath: "#/$defs/HttpTls/properties/ca_file/type", keyword: "type", params: { type: schema39.properties.ca_file.type }, message: "must be string,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data1.key_file !== undefined) {
                                        let data3 = data1.key_file;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "string") && (data3 !== null)) {
                                            validate25.errors = [{ instancePath: instancePath + "/tls/key_file", schemaPath: "#/$defs/HttpTls/properties/key_file/type", keyword: "type", params: { type: schema39.properties.key_file.type }, message: "must be string,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                    if (valid2) {
                                        if (data1.cert_file !== undefined) {
                                            let data4 = data1.cert_file;
                                            const _errs12 = errors;
                                            if ((typeof data4 !== "string") && (data4 !== null)) {
                                                validate25.errors = [{ instancePath: instancePath + "/tls/cert_file", schemaPath: "#/$defs/HttpTls/properties/cert_file/type", keyword: "type", params: { type: schema39.properties.cert_file.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            var valid2 = _errs12 === errors;
                                        }
                                        else {
                                            var valid2 = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.headers !== undefined) {
                        let data5 = data.headers;
                        const _errs14 = errors;
                        if (errors === _errs14) {
                            if (Array.isArray(data5)) {
                                if (data5.length < 1) {
                                    validate25.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                    return false;
                                }
                                else {
                                    var valid3 = true;
                                    const len0 = data5.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                        let data6 = data5[i0];
                                        const _errs16 = errors;
                                        const _errs17 = errors;
                                        if (errors === _errs17) {
                                            if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
                                                let missing0;
                                                if (((data6.name === undefined) && (missing0 = "name")) || ((data6.value === undefined) && (missing0 = "value"))) {
                                                    validate25.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
                                                    return false;
                                                }
                                                else {
                                                    const _errs19 = errors;
                                                    for (const key2 in data6) {
                                                        if (!((key2 === "name") || (key2 === "value"))) {
                                                            validate25.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                                            return false;
                                                            break;
                                                        }
                                                    }
                                                    if (_errs19 === errors) {
                                                        if (data6.name !== undefined) {
                                                            const _errs20 = errors;
                                                            if (typeof data6.name !== "string") {
                                                                validate25.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/name", schemaPath: "#/$defs/NameStringValuePair/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                return false;
                                                            }
                                                            var valid5 = _errs20 === errors;
                                                        }
                                                        else {
                                                            var valid5 = true;
                                                        }
                                                        if (valid5) {
                                                            if (data6.value !== undefined) {
                                                                let data8 = data6.value;
                                                                const _errs22 = errors;
                                                                if ((typeof data8 !== "string") && (data8 !== null)) {
                                                                    validate25.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/value", schemaPath: "#/$defs/NameStringValuePair/properties/value/type", keyword: "type", params: { type: schema40.properties.value.type }, message: "must be string,null" }];
                                                                    return false;
                                                                }
                                                                var valid5 = _errs22 === errors;
                                                            }
                                                            else {
                                                                var valid5 = true;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                validate25.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                return false;
                                            }
                                        }
                                        var valid3 = _errs16 === errors;
                                        if (!valid3) {
                                            break;
                                        }
                                    }
                                }
                            }
                            else {
                                validate25.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                return false;
                            }
                        }
                        var valid0 = _errs14 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.headers_list !== undefined) {
                            let data9 = data.headers_list;
                            const _errs24 = errors;
                            if ((typeof data9 !== "string") && (data9 !== null)) {
                                validate25.errors = [{ instancePath: instancePath + "/headers_list", schemaPath: "#/properties/headers_list/type", keyword: "type", params: { type: schema38.properties.headers_list.type }, message: "must be string,null" }];
                                return false;
                            }
                            var valid0 = _errs24 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.compression !== undefined) {
                                let data10 = data.compression;
                                const _errs26 = errors;
                                if ((typeof data10 !== "string") && (data10 !== null)) {
                                    validate25.errors = [{ instancePath: instancePath + "/compression", schemaPath: "#/properties/compression/type", keyword: "type", params: { type: schema38.properties.compression.type }, message: "must be string,null" }];
                                    return false;
                                }
                                var valid0 = _errs26 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.timeout !== undefined) {
                                    let data11 = data.timeout;
                                    const _errs28 = errors;
                                    if ((!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))) && (data11 !== null)) {
                                        validate25.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/type", keyword: "type", params: { type: schema38.properties.timeout.type }, message: "must be integer,null" }];
                                        return false;
                                    }
                                    if (errors === _errs28) {
                                        if (typeof data11 == "number") {
                                            if (data11 < 0 || isNaN(data11)) {
                                                validate25.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                return false;
                                            }
                                        }
                                    }
                                    var valid0 = _errs28 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.encoding !== undefined) {
                                        let data12 = data.encoding;
                                        const _errs30 = errors;
                                        if ((typeof data12 !== "string") && (data12 !== null)) {
                                            validate25.errors = [{ instancePath: instancePath + "/encoding", schemaPath: "#/$defs/OtlpHttpEncoding/type", keyword: "type", params: { type: schema41.type }, message: "must be string,null" }];
                                            return false;
                                        }
                                        if (!((data12 === "protobuf") || (data12 === "json"))) {
                                            validate25.errors = [{ instancePath: instancePath + "/encoding", schemaPath: "#/$defs/OtlpHttpEncoding/enum", keyword: "enum", params: { allowedValues: schema41.enum }, message: "must be equal to one of the allowed values" }];
                                            return false;
                                        }
                                        var valid0 = _errs30 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} validate25.errors = vErrors; return errors === 0; }
validate25.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema42 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint.\nIf omitted or null, http://localhost:4317 is used.\n" }, "tls": { "$ref": "#/$defs/GrpcTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" } } };
const schema43 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "ca_file": { "type": ["string", "null"], "description": "Configure certificate used to verify a server's TLS credentials. \nAbsolute path to certificate file in PEM format.\nIf omitted or null, system default certificate verification is used for secure connections.\n" }, "key_file": { "type": ["string", "null"], "description": "Configure mTLS private client key. \nAbsolute path to client key file in PEM format. If set, .client_certificate must also be set.\nIf omitted or null, mTLS is not used.\n" }, "cert_file": { "type": ["string", "null"], "description": "Configure mTLS client certificate. \nAbsolute path to client certificate file in PEM format. If set, .client_key must also be set.\nIf omitted or null, mTLS is not used.\n" }, "insecure": { "type": ["boolean", "null"], "description": "Configure client transport security for the exporter's connection. \nOnly applicable when .endpoint is provided without http or https scheme. Implementations may choose to ignore .insecure.\nIf omitted or null, false is used.\n" } } };
function validate27(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate27.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate27.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema42.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((((((key0 === "endpoint") || (key0 === "tls")) || (key0 === "headers")) || (key0 === "headers_list")) || (key0 === "compression")) || (key0 === "timeout"))) {
                validate27.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.endpoint !== undefined) {
                let data0 = data.endpoint;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate27.errors = [{ instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/type", keyword: "type", params: { type: schema42.properties.endpoint.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.tls !== undefined) {
                    let data1 = data.tls;
                    const _errs4 = errors;
                    const _errs5 = errors;
                    if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                        validate27.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/GrpcTls/type", keyword: "type", params: { type: schema43.type }, message: "must be object,null" }];
                        return false;
                    }
                    if (errors === _errs5) {
                        if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                            const _errs7 = errors;
                            for (const key1 in data1) {
                                if (!((((key1 === "ca_file") || (key1 === "key_file")) || (key1 === "cert_file")) || (key1 === "insecure"))) {
                                    validate27.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/GrpcTls/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                            if (_errs7 === errors) {
                                if (data1.ca_file !== undefined) {
                                    let data2 = data1.ca_file;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "string") && (data2 !== null)) {
                                        validate27.errors = [{ instancePath: instancePath + "/tls/ca_file", schemaPath: "#/$defs/GrpcTls/properties/ca_file/type", keyword: "type", params: { type: schema43.properties.ca_file.type }, message: "must be string,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data1.key_file !== undefined) {
                                        let data3 = data1.key_file;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "string") && (data3 !== null)) {
                                            validate27.errors = [{ instancePath: instancePath + "/tls/key_file", schemaPath: "#/$defs/GrpcTls/properties/key_file/type", keyword: "type", params: { type: schema43.properties.key_file.type }, message: "must be string,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                    if (valid2) {
                                        if (data1.cert_file !== undefined) {
                                            let data4 = data1.cert_file;
                                            const _errs12 = errors;
                                            if ((typeof data4 !== "string") && (data4 !== null)) {
                                                validate27.errors = [{ instancePath: instancePath + "/tls/cert_file", schemaPath: "#/$defs/GrpcTls/properties/cert_file/type", keyword: "type", params: { type: schema43.properties.cert_file.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            var valid2 = _errs12 === errors;
                                        }
                                        else {
                                            var valid2 = true;
                                        }
                                        if (valid2) {
                                            if (data1.insecure !== undefined) {
                                                let data5 = data1.insecure;
                                                const _errs14 = errors;
                                                if ((typeof data5 !== "boolean") && (data5 !== null)) {
                                                    validate27.errors = [{ instancePath: instancePath + "/tls/insecure", schemaPath: "#/$defs/GrpcTls/properties/insecure/type", keyword: "type", params: { type: schema43.properties.insecure.type }, message: "must be boolean,null" }];
                                                    return false;
                                                }
                                                var valid2 = _errs14 === errors;
                                            }
                                            else {
                                                var valid2 = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.headers !== undefined) {
                        let data6 = data.headers;
                        const _errs16 = errors;
                        if (errors === _errs16) {
                            if (Array.isArray(data6)) {
                                if (data6.length < 1) {
                                    validate27.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                    return false;
                                }
                                else {
                                    var valid3 = true;
                                    const len0 = data6.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                        let data7 = data6[i0];
                                        const _errs18 = errors;
                                        const _errs19 = errors;
                                        if (errors === _errs19) {
                                            if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
                                                let missing0;
                                                if (((data7.name === undefined) && (missing0 = "name")) || ((data7.value === undefined) && (missing0 = "value"))) {
                                                    validate27.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
                                                    return false;
                                                }
                                                else {
                                                    const _errs21 = errors;
                                                    for (const key2 in data7) {
                                                        if (!((key2 === "name") || (key2 === "value"))) {
                                                            validate27.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                                            return false;
                                                            break;
                                                        }
                                                    }
                                                    if (_errs21 === errors) {
                                                        if (data7.name !== undefined) {
                                                            const _errs22 = errors;
                                                            if (typeof data7.name !== "string") {
                                                                validate27.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/name", schemaPath: "#/$defs/NameStringValuePair/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                return false;
                                                            }
                                                            var valid5 = _errs22 === errors;
                                                        }
                                                        else {
                                                            var valid5 = true;
                                                        }
                                                        if (valid5) {
                                                            if (data7.value !== undefined) {
                                                                let data9 = data7.value;
                                                                const _errs24 = errors;
                                                                if ((typeof data9 !== "string") && (data9 !== null)) {
                                                                    validate27.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/value", schemaPath: "#/$defs/NameStringValuePair/properties/value/type", keyword: "type", params: { type: schema40.properties.value.type }, message: "must be string,null" }];
                                                                    return false;
                                                                }
                                                                var valid5 = _errs24 === errors;
                                                            }
                                                            else {
                                                                var valid5 = true;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                validate27.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                return false;
                                            }
                                        }
                                        var valid3 = _errs18 === errors;
                                        if (!valid3) {
                                            break;
                                        }
                                    }
                                }
                            }
                            else {
                                validate27.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                return false;
                            }
                        }
                        var valid0 = _errs16 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.headers_list !== undefined) {
                            let data10 = data.headers_list;
                            const _errs26 = errors;
                            if ((typeof data10 !== "string") && (data10 !== null)) {
                                validate27.errors = [{ instancePath: instancePath + "/headers_list", schemaPath: "#/properties/headers_list/type", keyword: "type", params: { type: schema42.properties.headers_list.type }, message: "must be string,null" }];
                                return false;
                            }
                            var valid0 = _errs26 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.compression !== undefined) {
                                let data11 = data.compression;
                                const _errs28 = errors;
                                if ((typeof data11 !== "string") && (data11 !== null)) {
                                    validate27.errors = [{ instancePath: instancePath + "/compression", schemaPath: "#/properties/compression/type", keyword: "type", params: { type: schema42.properties.compression.type }, message: "must be string,null" }];
                                    return false;
                                }
                                var valid0 = _errs28 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.timeout !== undefined) {
                                    let data12 = data.timeout;
                                    const _errs30 = errors;
                                    if ((!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))) && (data12 !== null)) {
                                        validate27.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/type", keyword: "type", params: { type: schema42.properties.timeout.type }, message: "must be integer,null" }];
                                        return false;
                                    }
                                    if (errors === _errs30) {
                                        if (typeof data12 == "number") {
                                            if (data12 < 0 || isNaN(data12)) {
                                                validate27.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                return false;
                                            }
                                        }
                                    }
                                    var valid0 = _errs30 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} validate27.errors = vErrors; return errors === 0; }
validate27.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate24(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate24.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate24.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate24.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((((key0 === "otlp_http") || (key0 === "otlp_grpc")) || (key0 === "otlp_file/development")) || (key0 === "console"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate24.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema37.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.otlp_http !== undefined) {
                        const _errs4 = errors;
                        if (!(validate25(data.otlp_http, { instancePath: instancePath + "/otlp_http", parentData: data, parentDataProperty: "otlp_http", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
                            errors = vErrors.length;
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.otlp_grpc !== undefined) {
                            const _errs5 = errors;
                            if (!(validate27(data.otlp_grpc, { instancePath: instancePath + "/otlp_grpc", parentData: data, parentDataProperty: "otlp_grpc", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
                                errors = vErrors.length;
                            }
                            var valid1 = _errs5 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data["otlp_file/development"] !== undefined) {
                                let data3 = data["otlp_file/development"];
                                const _errs6 = errors;
                                const _errs7 = errors;
                                if ((!(data3 && typeof data3 == "object" && !Array.isArray(data3))) && (data3 !== null)) {
                                    validate24.errors = [{ instancePath: instancePath + "/otlp_file~1development", schemaPath: "#/$defs/ExperimentalOtlpFileExporter/type", keyword: "type", params: { type: schema45.type }, message: "must be object,null" }];
                                    return false;
                                }
                                if (errors === _errs7) {
                                    if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                        const _errs9 = errors;
                                        for (const key1 in data3) {
                                            if (!(key1 === "output_stream")) {
                                                validate24.errors = [{ instancePath: instancePath + "/otlp_file~1development", schemaPath: "#/$defs/ExperimentalOtlpFileExporter/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                        if (_errs9 === errors) {
                                            if (data3.output_stream !== undefined) {
                                                let data4 = data3.output_stream;
                                                if ((typeof data4 !== "string") && (data4 !== null)) {
                                                    validate24.errors = [{ instancePath: instancePath + "/otlp_file~1development/output_stream", schemaPath: "#/$defs/ExperimentalOtlpFileExporter/properties/output_stream/type", keyword: "type", params: { type: schema45.properties.output_stream.type }, message: "must be string,null" }];
                                                    return false;
                                                }
                                            }
                                        }
                                    }
                                }
                                var valid1 = _errs6 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                            if (valid1) {
                                if (data.console !== undefined) {
                                    let data5 = data.console;
                                    const _errs12 = errors;
                                    const _errs13 = errors;
                                    if ((!(data5 && typeof data5 == "object" && !Array.isArray(data5))) && (data5 !== null)) {
                                        validate24.errors = [{ instancePath: instancePath + "/console", schemaPath: "#/$defs/ConsoleExporter/type", keyword: "type", params: { type: schema46.type }, message: "must be object,null" }];
                                        return false;
                                    }
                                    if (errors === _errs13) {
                                        if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
                                            for (const key2 in data5) {
                                                validate24.errors = [{ instancePath: instancePath + "/console", schemaPath: "#/$defs/ConsoleExporter/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                    }
                                    var valid1 = _errs12 === errors;
                                }
                                else {
                                    var valid1 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate24.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate24.errors = vErrors; return errors === 0; }
validate24.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate23(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate23.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.exporter === undefined) && (missing0 = "exporter")) {
            validate23.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((((key0 === "schedule_delay") || (key0 === "export_timeout")) || (key0 === "max_queue_size")) || (key0 === "max_export_batch_size")) || (key0 === "exporter"))) {
                    validate23.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.schedule_delay !== undefined) {
                    let data0 = data.schedule_delay;
                    const _errs2 = errors;
                    if ((!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))) && (data0 !== null)) {
                        validate23.errors = [{ instancePath: instancePath + "/schedule_delay", schemaPath: "#/properties/schedule_delay/type", keyword: "type", params: { type: schema36.properties.schedule_delay.type }, message: "must be integer,null" }];
                        return false;
                    }
                    if (errors === _errs2) {
                        if (typeof data0 == "number") {
                            if (data0 < 0 || isNaN(data0)) {
                                validate23.errors = [{ instancePath: instancePath + "/schedule_delay", schemaPath: "#/properties/schedule_delay/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                return false;
                            }
                        }
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.export_timeout !== undefined) {
                        let data1 = data.export_timeout;
                        const _errs4 = errors;
                        if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                            validate23.errors = [{ instancePath: instancePath + "/export_timeout", schemaPath: "#/properties/export_timeout/type", keyword: "type", params: { type: schema36.properties.export_timeout.type }, message: "must be integer,null" }];
                            return false;
                        }
                        if (errors === _errs4) {
                            if (typeof data1 == "number") {
                                if (data1 < 0 || isNaN(data1)) {
                                    validate23.errors = [{ instancePath: instancePath + "/export_timeout", schemaPath: "#/properties/export_timeout/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                    return false;
                                }
                            }
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.max_queue_size !== undefined) {
                            let data2 = data.max_queue_size;
                            const _errs6 = errors;
                            if ((!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))) && (data2 !== null)) {
                                validate23.errors = [{ instancePath: instancePath + "/max_queue_size", schemaPath: "#/properties/max_queue_size/type", keyword: "type", params: { type: schema36.properties.max_queue_size.type }, message: "must be integer,null" }];
                                return false;
                            }
                            if (errors === _errs6) {
                                if (typeof data2 == "number") {
                                    if (data2 <= 0 || isNaN(data2)) {
                                        validate23.errors = [{ instancePath: instancePath + "/max_queue_size", schemaPath: "#/properties/max_queue_size/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                        return false;
                                    }
                                }
                            }
                            var valid0 = _errs6 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.max_export_batch_size !== undefined) {
                                let data3 = data.max_export_batch_size;
                                const _errs8 = errors;
                                if ((!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))) && (data3 !== null)) {
                                    validate23.errors = [{ instancePath: instancePath + "/max_export_batch_size", schemaPath: "#/properties/max_export_batch_size/type", keyword: "type", params: { type: schema36.properties.max_export_batch_size.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs8) {
                                    if (typeof data3 == "number") {
                                        if (data3 <= 0 || isNaN(data3)) {
                                            validate23.errors = [{ instancePath: instancePath + "/max_export_batch_size", schemaPath: "#/properties/max_export_batch_size/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid0 = _errs8 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.exporter !== undefined) {
                                    const _errs10 = errors;
                                    if (!(validate24(data.exporter, { instancePath: instancePath + "/exporter", parentData: data, parentDataProperty: "exporter", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid0 = _errs10 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate23.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate23.errors = vErrors; return errors === 0; }
validate23.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema47 = { "type": "object", "additionalProperties": false, "properties": { "exporter": { "$ref": "#/$defs/LogRecordExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] };
function validate31(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate31.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.exporter === undefined) && (missing0 = "exporter")) {
            validate31.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(key0 === "exporter")) {
                    validate31.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.exporter !== undefined) {
                    if (!(validate24(data.exporter, { instancePath: instancePath + "/exporter", parentData: data, parentDataProperty: "exporter", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
                        errors = vErrors.length;
                    }
                }
            }
        }
    }
    else {
        validate31.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate31.errors = vErrors; return errors === 0; }
validate31.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate22.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate22.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate22.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!(((key0 === "batch") || (key0 === "simple")) || (key0 === "event_to_span_event_bridge/development"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate22.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema35.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.batch !== undefined) {
                        const _errs4 = errors;
                        if (!(validate23(data.batch, { instancePath: instancePath + "/batch", parentData: data, parentDataProperty: "batch", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
                            errors = vErrors.length;
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.simple !== undefined) {
                            const _errs5 = errors;
                            if (!(validate31(data.simple, { instancePath: instancePath + "/simple", parentData: data, parentDataProperty: "simple", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
                                errors = vErrors.length;
                            }
                            var valid1 = _errs5 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data["event_to_span_event_bridge/development"] !== undefined) {
                                let data3 = data["event_to_span_event_bridge/development"];
                                const _errs6 = errors;
                                const _errs7 = errors;
                                if ((!(data3 && typeof data3 == "object" && !Array.isArray(data3))) && (data3 !== null)) {
                                    validate22.errors = [{ instancePath: instancePath + "/event_to_span_event_bridge~1development", schemaPath: "#/$defs/ExperimentalEventToSpanEventBridgeLogRecordProcessor/type", keyword: "type", params: { type: schema48.type }, message: "must be object,null" }];
                                    return false;
                                }
                                if (errors === _errs7) {
                                    if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                        for (const key1 in data3) {
                                            validate22.errors = [{ instancePath: instancePath + "/event_to_span_event_bridge~1development", schemaPath: "#/$defs/ExperimentalEventToSpanEventBridgeLogRecordProcessor/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                            return false;
                                            break;
                                        }
                                    }
                                }
                                var valid1 = _errs6 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate22.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate22.errors = vErrors; return errors === 0; }
validate22.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema50 = { "type": ["object"], "additionalProperties": false, "properties": { "default_config": { "$ref": "#/$defs/ExperimentalLoggerConfig", "description": "Configure the default logger config used there is no matching entry in .logger_configurator/development.loggers.\nIf omitted, unmatched .loggers use default values as described in ExperimentalLoggerConfig.\n" }, "loggers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalLoggerMatcherAndConfig" }, "description": "Configure loggers.\nIf omitted, all loggers use .default_config.\n" } } };
const schema51 = { "type": ["object"], "additionalProperties": false, "properties": { "enabled": { "type": ["boolean", "null"], "description": "Configure if the logger is enabled or not.\nIf omitted or null, true is used.\n" }, "minimum_severity": { "$ref": "#/$defs/SeverityNumber", "description": "Configure severity filtering.\nLog records with an non-zero (i.e. unspecified) severity number which is less than minimum_severity are not processed.\nValues include:\n* debug: debug, severity number 5.\n* debug2: debug2, severity number 6.\n* debug3: debug3, severity number 7.\n* debug4: debug4, severity number 8.\n* error: error, severity number 17.\n* error2: error2, severity number 18.\n* error3: error3, severity number 19.\n* error4: error4, severity number 20.\n* fatal: fatal, severity number 21.\n* fatal2: fatal2, severity number 22.\n* fatal3: fatal3, severity number 23.\n* fatal4: fatal4, severity number 24.\n* info: info, severity number 9.\n* info2: info2, severity number 10.\n* info3: info3, severity number 11.\n* info4: info4, severity number 12.\n* trace: trace, severity number 1.\n* trace2: trace2, severity number 2.\n* trace3: trace3, severity number 3.\n* trace4: trace4, severity number 4.\n* warn: warn, severity number 13.\n* warn2: warn2, severity number 14.\n* warn3: warn3, severity number 15.\n* warn4: warn4, severity number 16.\nIf omitted, severity filtering is not applied.\n" }, "trace_based": { "type": ["boolean", "null"], "description": "Configure trace based filtering.\nIf true, log records associated with unsampled trace contexts traces are not processed. If false, or if a log record is not associated with a trace context, trace based filtering is not applied.\nIf omitted or null, trace based filtering is not applied.\n" } } };
function validate36(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate36.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(((key0 === "enabled") || (key0 === "minimum_severity")) || (key0 === "trace_based"))) {
                validate36.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.enabled !== undefined) {
                let data0 = data.enabled;
                const _errs2 = errors;
                if ((typeof data0 !== "boolean") && (data0 !== null)) {
                    validate36.errors = [{ instancePath: instancePath + "/enabled", schemaPath: "#/properties/enabled/type", keyword: "type", params: { type: schema51.properties.enabled.type }, message: "must be boolean,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.minimum_severity !== undefined) {
                    let data1 = data.minimum_severity;
                    const _errs4 = errors;
                    if ((typeof data1 !== "string") && (data1 !== null)) {
                        validate36.errors = [{ instancePath: instancePath + "/minimum_severity", schemaPath: "#/$defs/SeverityNumber/type", keyword: "type", params: { type: schema32.type }, message: "must be string,null" }];
                        return false;
                    }
                    if (!((((((((((((((((((((((((data1 === "trace") || (data1 === "trace2")) || (data1 === "trace3")) || (data1 === "trace4")) || (data1 === "debug")) || (data1 === "debug2")) || (data1 === "debug3")) || (data1 === "debug4")) || (data1 === "info")) || (data1 === "info2")) || (data1 === "info3")) || (data1 === "info4")) || (data1 === "warn")) || (data1 === "warn2")) || (data1 === "warn3")) || (data1 === "warn4")) || (data1 === "error")) || (data1 === "error2")) || (data1 === "error3")) || (data1 === "error4")) || (data1 === "fatal")) || (data1 === "fatal2")) || (data1 === "fatal3")) || (data1 === "fatal4"))) {
                        validate36.errors = [{ instancePath: instancePath + "/minimum_severity", schemaPath: "#/$defs/SeverityNumber/enum", keyword: "enum", params: { allowedValues: schema32.enum }, message: "must be equal to one of the allowed values" }];
                        return false;
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.trace_based !== undefined) {
                        let data2 = data.trace_based;
                        const _errs7 = errors;
                        if ((typeof data2 !== "boolean") && (data2 !== null)) {
                            validate36.errors = [{ instancePath: instancePath + "/trace_based", schemaPath: "#/properties/trace_based/type", keyword: "type", params: { type: schema51.properties.trace_based.type }, message: "must be boolean,null" }];
                            return false;
                        }
                        var valid0 = _errs7 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                }
            }
        }
    }
    else {
        validate36.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema51.type }, message: "must be object" }];
        return false;
    }
} validate36.errors = vErrors; return errors === 0; }
validate36.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema53 = { "type": ["object"], "additionalProperties": false, "properties": { "name": { "type": ["string"], "description": "Configure logger names to match. Matching is case-sensitive, evaluated as follows:\n\n * If the logger name exactly matches.\n * If the logger name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nProperty is required and must be non-null.\n" }, "config": { "$ref": "#/$defs/ExperimentalLoggerConfig", "description": "The logger config.\nProperty is required and must be non-null.\n" } }, "required": ["name", "config"] };
function validate38(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate38.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if (((data.name === undefined) && (missing0 = "name")) || ((data.config === undefined) && (missing0 = "config"))) {
            validate38.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!((key0 === "name") || (key0 === "config"))) {
                    validate38.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.name !== undefined) {
                    const _errs2 = errors;
                    if (typeof data.name !== "string") {
                        validate38.errors = [{ instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: schema53.properties.name.type }, message: "must be string" }];
                        return false;
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.config !== undefined) {
                        const _errs4 = errors;
                        if (!(validate36(data.config, { instancePath: instancePath + "/config", parentData: data, parentDataProperty: "config", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate36.errors : vErrors.concat(validate36.errors);
                            errors = vErrors.length;
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                }
            }
        }
    }
    else {
        validate38.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema53.type }, message: "must be object" }];
        return false;
    }
} validate38.errors = vErrors; return errors === 0; }
validate38.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate35(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate35.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((key0 === "default_config") || (key0 === "loggers"))) {
                validate35.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.default_config !== undefined) {
                const _errs2 = errors;
                if (!(validate36(data.default_config, { instancePath: instancePath + "/default_config", parentData: data, parentDataProperty: "default_config", rootData, dynamicAnchors }))) {
                    vErrors = vErrors === null ? validate36.errors : vErrors.concat(validate36.errors);
                    errors = vErrors.length;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.loggers !== undefined) {
                    let data1 = data.loggers;
                    const _errs3 = errors;
                    if (errors === _errs3) {
                        if (Array.isArray(data1)) {
                            if (data1.length < 1) {
                                validate35.errors = [{ instancePath: instancePath + "/loggers", schemaPath: "#/properties/loggers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                return false;
                            }
                            else {
                                var valid1 = true;
                                const len0 = data1.length;
                                for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs5 = errors;
                                    if (!(validate38(data1[i0], { instancePath: instancePath + "/loggers/" + i0, parentData: data1, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate38.errors : vErrors.concat(validate38.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid1 = _errs5 === errors;
                                    if (!valid1) {
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            validate35.errors = [{ instancePath: instancePath + "/loggers", schemaPath: "#/properties/loggers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                        }
                    }
                    var valid0 = _errs3 === errors;
                }
                else {
                    var valid0 = true;
                }
            }
        }
    }
    else {
        validate35.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema50.type }, message: "must be object" }];
        return false;
    }
} validate35.errors = vErrors; return errors === 0; }
validate35.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate21.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.processors === undefined) && (missing0 = "processors")) {
            validate21.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((key0 === "processors") || (key0 === "limits")) || (key0 === "logger_configurator/development"))) {
                    validate21.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.processors !== undefined) {
                    let data0 = data.processors;
                    const _errs2 = errors;
                    if (errors === _errs2) {
                        if (Array.isArray(data0)) {
                            if (data0.length < 1) {
                                validate21.errors = [{ instancePath: instancePath + "/processors", schemaPath: "#/properties/processors/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                return false;
                            }
                            else {
                                var valid1 = true;
                                const len0 = data0.length;
                                for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs4 = errors;
                                    if (!(validate22(data0[i0], { instancePath: instancePath + "/processors/" + i0, parentData: data0, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid1 = _errs4 === errors;
                                    if (!valid1) {
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            validate21.errors = [{ instancePath: instancePath + "/processors", schemaPath: "#/properties/processors/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                        }
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.limits !== undefined) {
                        let data2 = data.limits;
                        const _errs5 = errors;
                        const _errs6 = errors;
                        if (errors === _errs6) {
                            if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                                const _errs8 = errors;
                                for (const key1 in data2) {
                                    if (!((key1 === "attribute_value_length_limit") || (key1 === "attribute_count_limit"))) {
                                        validate21.errors = [{ instancePath: instancePath + "/limits", schemaPath: "#/$defs/LogRecordLimits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                                if (_errs8 === errors) {
                                    if (data2.attribute_value_length_limit !== undefined) {
                                        let data3 = data2.attribute_value_length_limit;
                                        const _errs9 = errors;
                                        if ((!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))) && (data3 !== null)) {
                                            validate21.errors = [{ instancePath: instancePath + "/limits/attribute_value_length_limit", schemaPath: "#/$defs/LogRecordLimits/properties/attribute_value_length_limit/type", keyword: "type", params: { type: schema49.properties.attribute_value_length_limit.type }, message: "must be integer,null" }];
                                            return false;
                                        }
                                        if (errors === _errs9) {
                                            if (typeof data3 == "number") {
                                                if (data3 < 0 || isNaN(data3)) {
                                                    validate21.errors = [{ instancePath: instancePath + "/limits/attribute_value_length_limit", schemaPath: "#/$defs/LogRecordLimits/properties/attribute_value_length_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                    return false;
                                                }
                                            }
                                        }
                                        var valid3 = _errs9 === errors;
                                    }
                                    else {
                                        var valid3 = true;
                                    }
                                    if (valid3) {
                                        if (data2.attribute_count_limit !== undefined) {
                                            let data4 = data2.attribute_count_limit;
                                            const _errs11 = errors;
                                            if ((!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))) && (data4 !== null)) {
                                                validate21.errors = [{ instancePath: instancePath + "/limits/attribute_count_limit", schemaPath: "#/$defs/LogRecordLimits/properties/attribute_count_limit/type", keyword: "type", params: { type: schema49.properties.attribute_count_limit.type }, message: "must be integer,null" }];
                                                return false;
                                            }
                                            if (errors === _errs11) {
                                                if (typeof data4 == "number") {
                                                    if (data4 < 0 || isNaN(data4)) {
                                                        validate21.errors = [{ instancePath: instancePath + "/limits/attribute_count_limit", schemaPath: "#/$defs/LogRecordLimits/properties/attribute_count_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                        return false;
                                                    }
                                                }
                                            }
                                            var valid3 = _errs11 === errors;
                                        }
                                        else {
                                            var valid3 = true;
                                        }
                                    }
                                }
                            }
                            else {
                                validate21.errors = [{ instancePath: instancePath + "/limits", schemaPath: "#/$defs/LogRecordLimits/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                return false;
                            }
                        }
                        var valid0 = _errs5 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data["logger_configurator/development"] !== undefined) {
                            const _errs13 = errors;
                            if (!(validate35(data["logger_configurator/development"], { instancePath: instancePath + "/logger_configurator~1development", parentData: data, parentDataProperty: "logger_configurator/development", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors);
                                errors = vErrors.length;
                            }
                            var valid0 = _errs13 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                    }
                }
            }
        }
    }
    else {
        validate21.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate21.errors = vErrors; return errors === 0; }
validate21.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema54 = { "type": "object", "additionalProperties": false, "properties": { "readers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/MetricReader" }, "description": "Configure metric readers.\nProperty is required and must be non-null.\n" }, "views": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/View" }, "description": "Configure views. \nEach view has a selector which determines the instrument(s) it applies to, and a configuration for the resulting stream(s).\nIf omitted, no views are registered.\n" }, "exemplar_filter": { "$ref": "#/$defs/ExemplarFilter", "description": "Configure the exemplar filter.\nValues include:\n* always_off: ExemplarFilter which makes no measurements eligible for being an Exemplar.\n* always_on: ExemplarFilter which makes all measurements eligible for being an Exemplar.\n* trace_based: ExemplarFilter which makes measurements recorded in the context of a sampled parent span eligible for being an Exemplar.\nIf omitted, trace_based is used.\n" }, "meter_configurator/development": { "$ref": "#/$defs/ExperimentalMeterConfigurator", "description": "Configure meters.\nIf omitted, all meters use default values as described in ExperimentalMeterConfig.\n" } }, "required": ["readers"] };
const schema96 = { "type": ["string", "null"], "enum": ["always_on", "always_off", "trace_based"] };
const schema55 = { "type": "object", "additionalProperties": false, "minProperties": 1, "maxProperties": 1, "properties": { "periodic": { "$ref": "#/$defs/PeriodicMetricReader", "description": "Configure a periodic metric reader.\nIf omitted, ignore.\n" }, "pull": { "$ref": "#/$defs/PullMetricReader", "description": "Configure a pull based metric reader.\nIf omitted, ignore.\n" } } };
const schema56 = { "type": "object", "additionalProperties": false, "properties": { "interval": { "type": ["integer", "null"], "minimum": 0, "description": "Configure delay interval (in milliseconds) between start of two consecutive exports. \nValue must be non-negative.\nIf omitted or null, 60000 is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure maximum allowed time (in milliseconds) to export data. \nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 30000 is used.\n" }, "max_export_batch_size/development": { "type": ["integer", "null"], "minimum": 1, "description": "Configure maximum export batch size.\nIf omitted or null, no limit is used.\n" }, "exporter": { "$ref": "#/$defs/PushMetricExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" }, "producers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/MetricProducer" }, "description": "Configure metric producers.\nIf omitted, no metric producers are added.\n" }, "cardinality_limits": { "$ref": "#/$defs/CardinalityLimits", "description": "Configure cardinality limits.\nIf omitted, default values as described in CardinalityLimits are used.\n" } }, "required": ["exporter"] };
const schema77 = { "type": "object", "additionalProperties": false, "properties": { "default": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for all instrument types.\nInstrument-specific cardinality limits take priority.\nIf omitted or null, 2000 is used.\n" }, "counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for counter instruments.\nIf omitted or null, the value from .default is used.\n" }, "gauge": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for gauge instruments.\nIf omitted or null, the value from .default is used.\n" }, "histogram": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for histogram instruments.\nIf omitted or null, the value from .default is used.\n" }, "observable_counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for observable_counter instruments.\nIf omitted or null, the value from .default is used.\n" }, "observable_gauge": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for observable_gauge instruments.\nIf omitted or null, the value from .default is used.\n" }, "observable_up_down_counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for observable_up_down_counter instruments.\nIf omitted or null, the value from .default is used.\n" }, "up_down_counter": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure default cardinality limit for up_down_counter instruments.\nIf omitted or null, the value from .default is used.\n" } } };
const schema57 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "otlp_http": { "$ref": "#/$defs/OtlpHttpMetricExporter", "description": "Configure exporter to be OTLP with HTTP transport.\nIf omitted, ignore.\n" }, "otlp_grpc": { "$ref": "#/$defs/OtlpGrpcMetricExporter", "description": "Configure exporter to be OTLP with gRPC transport.\nIf omitted, ignore.\n" }, "otlp_file/development": { "$ref": "#/$defs/ExperimentalOtlpFileMetricExporter", "description": "Configure exporter to be OTLP with file transport.\nIf omitted, ignore.\n" }, "console": { "$ref": "#/$defs/ConsoleMetricExporter", "description": "Configure exporter to be console.\nIf omitted, ignore.\n" } } };
const schema58 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint.\nIf omitted or null, http://localhost:4318/v1/metrics is used.\n" }, "tls": { "$ref": "#/$defs/HttpTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" }, "encoding": { "$ref": "#/$defs/OtlpHttpEncoding", "description": "Configure the encoding used for messages. \nImplementations may not support json.\nValues include:\n* json: Protobuf JSON encoding.\n* protobuf: Protobuf binary encoding.\nIf omitted, protobuf is used.\n" }, "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } };
const schema62 = { "type": ["string", "null"], "enum": ["cumulative", "delta", "low_memory"] };
const schema63 = { "type": ["string", "null"], "enum": ["explicit_bucket_histogram", "base2_exponential_bucket_histogram"] };
const func1 = Object.prototype.hasOwnProperty;
function validate47(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate47.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate47.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema58.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(func1.call(schema58.properties, key0))) {
                validate47.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.endpoint !== undefined) {
                let data0 = data.endpoint;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate47.errors = [{ instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/type", keyword: "type", params: { type: schema58.properties.endpoint.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.tls !== undefined) {
                    let data1 = data.tls;
                    const _errs4 = errors;
                    const _errs5 = errors;
                    if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                        validate47.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/HttpTls/type", keyword: "type", params: { type: schema39.type }, message: "must be object,null" }];
                        return false;
                    }
                    if (errors === _errs5) {
                        if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                            const _errs7 = errors;
                            for (const key1 in data1) {
                                if (!(((key1 === "ca_file") || (key1 === "key_file")) || (key1 === "cert_file"))) {
                                    validate47.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/HttpTls/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                            if (_errs7 === errors) {
                                if (data1.ca_file !== undefined) {
                                    let data2 = data1.ca_file;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "string") && (data2 !== null)) {
                                        validate47.errors = [{ instancePath: instancePath + "/tls/ca_file", schemaPath: "#/$defs/HttpTls/properties/ca_file/type", keyword: "type", params: { type: schema39.properties.ca_file.type }, message: "must be string,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data1.key_file !== undefined) {
                                        let data3 = data1.key_file;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "string") && (data3 !== null)) {
                                            validate47.errors = [{ instancePath: instancePath + "/tls/key_file", schemaPath: "#/$defs/HttpTls/properties/key_file/type", keyword: "type", params: { type: schema39.properties.key_file.type }, message: "must be string,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                    if (valid2) {
                                        if (data1.cert_file !== undefined) {
                                            let data4 = data1.cert_file;
                                            const _errs12 = errors;
                                            if ((typeof data4 !== "string") && (data4 !== null)) {
                                                validate47.errors = [{ instancePath: instancePath + "/tls/cert_file", schemaPath: "#/$defs/HttpTls/properties/cert_file/type", keyword: "type", params: { type: schema39.properties.cert_file.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            var valid2 = _errs12 === errors;
                                        }
                                        else {
                                            var valid2 = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.headers !== undefined) {
                        let data5 = data.headers;
                        const _errs14 = errors;
                        if (errors === _errs14) {
                            if (Array.isArray(data5)) {
                                if (data5.length < 1) {
                                    validate47.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                    return false;
                                }
                                else {
                                    var valid3 = true;
                                    const len0 = data5.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                        let data6 = data5[i0];
                                        const _errs16 = errors;
                                        const _errs17 = errors;
                                        if (errors === _errs17) {
                                            if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
                                                let missing0;
                                                if (((data6.name === undefined) && (missing0 = "name")) || ((data6.value === undefined) && (missing0 = "value"))) {
                                                    validate47.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
                                                    return false;
                                                }
                                                else {
                                                    const _errs19 = errors;
                                                    for (const key2 in data6) {
                                                        if (!((key2 === "name") || (key2 === "value"))) {
                                                            validate47.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                                            return false;
                                                            break;
                                                        }
                                                    }
                                                    if (_errs19 === errors) {
                                                        if (data6.name !== undefined) {
                                                            const _errs20 = errors;
                                                            if (typeof data6.name !== "string") {
                                                                validate47.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/name", schemaPath: "#/$defs/NameStringValuePair/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                return false;
                                                            }
                                                            var valid5 = _errs20 === errors;
                                                        }
                                                        else {
                                                            var valid5 = true;
                                                        }
                                                        if (valid5) {
                                                            if (data6.value !== undefined) {
                                                                let data8 = data6.value;
                                                                const _errs22 = errors;
                                                                if ((typeof data8 !== "string") && (data8 !== null)) {
                                                                    validate47.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/value", schemaPath: "#/$defs/NameStringValuePair/properties/value/type", keyword: "type", params: { type: schema40.properties.value.type }, message: "must be string,null" }];
                                                                    return false;
                                                                }
                                                                var valid5 = _errs22 === errors;
                                                            }
                                                            else {
                                                                var valid5 = true;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                validate47.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                return false;
                                            }
                                        }
                                        var valid3 = _errs16 === errors;
                                        if (!valid3) {
                                            break;
                                        }
                                    }
                                }
                            }
                            else {
                                validate47.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                return false;
                            }
                        }
                        var valid0 = _errs14 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.headers_list !== undefined) {
                            let data9 = data.headers_list;
                            const _errs24 = errors;
                            if ((typeof data9 !== "string") && (data9 !== null)) {
                                validate47.errors = [{ instancePath: instancePath + "/headers_list", schemaPath: "#/properties/headers_list/type", keyword: "type", params: { type: schema58.properties.headers_list.type }, message: "must be string,null" }];
                                return false;
                            }
                            var valid0 = _errs24 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.compression !== undefined) {
                                let data10 = data.compression;
                                const _errs26 = errors;
                                if ((typeof data10 !== "string") && (data10 !== null)) {
                                    validate47.errors = [{ instancePath: instancePath + "/compression", schemaPath: "#/properties/compression/type", keyword: "type", params: { type: schema58.properties.compression.type }, message: "must be string,null" }];
                                    return false;
                                }
                                var valid0 = _errs26 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.timeout !== undefined) {
                                    let data11 = data.timeout;
                                    const _errs28 = errors;
                                    if ((!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))) && (data11 !== null)) {
                                        validate47.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/type", keyword: "type", params: { type: schema58.properties.timeout.type }, message: "must be integer,null" }];
                                        return false;
                                    }
                                    if (errors === _errs28) {
                                        if (typeof data11 == "number") {
                                            if (data11 < 0 || isNaN(data11)) {
                                                validate47.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                return false;
                                            }
                                        }
                                    }
                                    var valid0 = _errs28 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.encoding !== undefined) {
                                        let data12 = data.encoding;
                                        const _errs30 = errors;
                                        if ((typeof data12 !== "string") && (data12 !== null)) {
                                            validate47.errors = [{ instancePath: instancePath + "/encoding", schemaPath: "#/$defs/OtlpHttpEncoding/type", keyword: "type", params: { type: schema41.type }, message: "must be string,null" }];
                                            return false;
                                        }
                                        if (!((data12 === "protobuf") || (data12 === "json"))) {
                                            validate47.errors = [{ instancePath: instancePath + "/encoding", schemaPath: "#/$defs/OtlpHttpEncoding/enum", keyword: "enum", params: { allowedValues: schema41.enum }, message: "must be equal to one of the allowed values" }];
                                            return false;
                                        }
                                        var valid0 = _errs30 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                    if (valid0) {
                                        if (data.temporality_preference !== undefined) {
                                            let data13 = data.temporality_preference;
                                            const _errs33 = errors;
                                            if ((typeof data13 !== "string") && (data13 !== null)) {
                                                validate47.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/type", keyword: "type", params: { type: schema62.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            if (!(((data13 === "cumulative") || (data13 === "delta")) || (data13 === "low_memory"))) {
                                                validate47.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/enum", keyword: "enum", params: { allowedValues: schema62.enum }, message: "must be equal to one of the allowed values" }];
                                                return false;
                                            }
                                            var valid0 = _errs33 === errors;
                                        }
                                        else {
                                            var valid0 = true;
                                        }
                                        if (valid0) {
                                            if (data.default_histogram_aggregation !== undefined) {
                                                let data14 = data.default_histogram_aggregation;
                                                const _errs36 = errors;
                                                if ((typeof data14 !== "string") && (data14 !== null)) {
                                                    validate47.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/type", keyword: "type", params: { type: schema63.type }, message: "must be string,null" }];
                                                    return false;
                                                }
                                                if (!((data14 === "explicit_bucket_histogram") || (data14 === "base2_exponential_bucket_histogram"))) {
                                                    validate47.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/enum", keyword: "enum", params: { allowedValues: schema63.enum }, message: "must be equal to one of the allowed values" }];
                                                    return false;
                                                }
                                                var valid0 = _errs36 === errors;
                                            }
                                            else {
                                                var valid0 = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} validate47.errors = vErrors; return errors === 0; }
validate47.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema64 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string", "null"], "description": "Configure endpoint.\nIf omitted or null, http://localhost:4317 is used.\n" }, "tls": { "$ref": "#/$defs/GrpcTls", "description": "Configure TLS settings for the exporter.\nIf omitted, system default TLS settings are used.\n" }, "headers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/NameStringValuePair" }, "description": "Configure headers. Entries have higher priority than entries from .headers_list.\nIf an entry's .value is null, the entry is ignored.\nIf omitted, no headers are added.\n" }, "headers_list": { "type": ["string", "null"], "description": "Configure headers. Entries have lower priority than entries from .headers.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_EXPORTER_OTLP_HEADERS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md#configuration-options for details.\nIf omitted or null, no headers are added.\n" }, "compression": { "type": ["string", "null"], "description": "Configure compression.\nKnown values include: gzip, none. Implementations may support other compression algorithms.\nIf omitted or null, none is used.\n" }, "timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max time (in milliseconds) to wait for each export.\nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 10000 is used.\n" }, "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } };
function validate49(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate49.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate49.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema64.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((((((((key0 === "endpoint") || (key0 === "tls")) || (key0 === "headers")) || (key0 === "headers_list")) || (key0 === "compression")) || (key0 === "timeout")) || (key0 === "temporality_preference")) || (key0 === "default_histogram_aggregation"))) {
                validate49.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.endpoint !== undefined) {
                let data0 = data.endpoint;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate49.errors = [{ instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/type", keyword: "type", params: { type: schema64.properties.endpoint.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.tls !== undefined) {
                    let data1 = data.tls;
                    const _errs4 = errors;
                    const _errs5 = errors;
                    if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                        validate49.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/GrpcTls/type", keyword: "type", params: { type: schema43.type }, message: "must be object,null" }];
                        return false;
                    }
                    if (errors === _errs5) {
                        if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                            const _errs7 = errors;
                            for (const key1 in data1) {
                                if (!((((key1 === "ca_file") || (key1 === "key_file")) || (key1 === "cert_file")) || (key1 === "insecure"))) {
                                    validate49.errors = [{ instancePath: instancePath + "/tls", schemaPath: "#/$defs/GrpcTls/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                            if (_errs7 === errors) {
                                if (data1.ca_file !== undefined) {
                                    let data2 = data1.ca_file;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "string") && (data2 !== null)) {
                                        validate49.errors = [{ instancePath: instancePath + "/tls/ca_file", schemaPath: "#/$defs/GrpcTls/properties/ca_file/type", keyword: "type", params: { type: schema43.properties.ca_file.type }, message: "must be string,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data1.key_file !== undefined) {
                                        let data3 = data1.key_file;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "string") && (data3 !== null)) {
                                            validate49.errors = [{ instancePath: instancePath + "/tls/key_file", schemaPath: "#/$defs/GrpcTls/properties/key_file/type", keyword: "type", params: { type: schema43.properties.key_file.type }, message: "must be string,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                    if (valid2) {
                                        if (data1.cert_file !== undefined) {
                                            let data4 = data1.cert_file;
                                            const _errs12 = errors;
                                            if ((typeof data4 !== "string") && (data4 !== null)) {
                                                validate49.errors = [{ instancePath: instancePath + "/tls/cert_file", schemaPath: "#/$defs/GrpcTls/properties/cert_file/type", keyword: "type", params: { type: schema43.properties.cert_file.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            var valid2 = _errs12 === errors;
                                        }
                                        else {
                                            var valid2 = true;
                                        }
                                        if (valid2) {
                                            if (data1.insecure !== undefined) {
                                                let data5 = data1.insecure;
                                                const _errs14 = errors;
                                                if ((typeof data5 !== "boolean") && (data5 !== null)) {
                                                    validate49.errors = [{ instancePath: instancePath + "/tls/insecure", schemaPath: "#/$defs/GrpcTls/properties/insecure/type", keyword: "type", params: { type: schema43.properties.insecure.type }, message: "must be boolean,null" }];
                                                    return false;
                                                }
                                                var valid2 = _errs14 === errors;
                                            }
                                            else {
                                                var valid2 = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.headers !== undefined) {
                        let data6 = data.headers;
                        const _errs16 = errors;
                        if (errors === _errs16) {
                            if (Array.isArray(data6)) {
                                if (data6.length < 1) {
                                    validate49.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                    return false;
                                }
                                else {
                                    var valid3 = true;
                                    const len0 = data6.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                        let data7 = data6[i0];
                                        const _errs18 = errors;
                                        const _errs19 = errors;
                                        if (errors === _errs19) {
                                            if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
                                                let missing0;
                                                if (((data7.name === undefined) && (missing0 = "name")) || ((data7.value === undefined) && (missing0 = "value"))) {
                                                    validate49.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
                                                    return false;
                                                }
                                                else {
                                                    const _errs21 = errors;
                                                    for (const key2 in data7) {
                                                        if (!((key2 === "name") || (key2 === "value"))) {
                                                            validate49.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                                            return false;
                                                            break;
                                                        }
                                                    }
                                                    if (_errs21 === errors) {
                                                        if (data7.name !== undefined) {
                                                            const _errs22 = errors;
                                                            if (typeof data7.name !== "string") {
                                                                validate49.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/name", schemaPath: "#/$defs/NameStringValuePair/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                return false;
                                                            }
                                                            var valid5 = _errs22 === errors;
                                                        }
                                                        else {
                                                            var valid5 = true;
                                                        }
                                                        if (valid5) {
                                                            if (data7.value !== undefined) {
                                                                let data9 = data7.value;
                                                                const _errs24 = errors;
                                                                if ((typeof data9 !== "string") && (data9 !== null)) {
                                                                    validate49.errors = [{ instancePath: instancePath + "/headers/" + i0 + "/value", schemaPath: "#/$defs/NameStringValuePair/properties/value/type", keyword: "type", params: { type: schema40.properties.value.type }, message: "must be string,null" }];
                                                                    return false;
                                                                }
                                                                var valid5 = _errs24 === errors;
                                                            }
                                                            else {
                                                                var valid5 = true;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                validate49.errors = [{ instancePath: instancePath + "/headers/" + i0, schemaPath: "#/$defs/NameStringValuePair/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                return false;
                                            }
                                        }
                                        var valid3 = _errs18 === errors;
                                        if (!valid3) {
                                            break;
                                        }
                                    }
                                }
                            }
                            else {
                                validate49.errors = [{ instancePath: instancePath + "/headers", schemaPath: "#/properties/headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                return false;
                            }
                        }
                        var valid0 = _errs16 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.headers_list !== undefined) {
                            let data10 = data.headers_list;
                            const _errs26 = errors;
                            if ((typeof data10 !== "string") && (data10 !== null)) {
                                validate49.errors = [{ instancePath: instancePath + "/headers_list", schemaPath: "#/properties/headers_list/type", keyword: "type", params: { type: schema64.properties.headers_list.type }, message: "must be string,null" }];
                                return false;
                            }
                            var valid0 = _errs26 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.compression !== undefined) {
                                let data11 = data.compression;
                                const _errs28 = errors;
                                if ((typeof data11 !== "string") && (data11 !== null)) {
                                    validate49.errors = [{ instancePath: instancePath + "/compression", schemaPath: "#/properties/compression/type", keyword: "type", params: { type: schema64.properties.compression.type }, message: "must be string,null" }];
                                    return false;
                                }
                                var valid0 = _errs28 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.timeout !== undefined) {
                                    let data12 = data.timeout;
                                    const _errs30 = errors;
                                    if ((!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))) && (data12 !== null)) {
                                        validate49.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/type", keyword: "type", params: { type: schema64.properties.timeout.type }, message: "must be integer,null" }];
                                        return false;
                                    }
                                    if (errors === _errs30) {
                                        if (typeof data12 == "number") {
                                            if (data12 < 0 || isNaN(data12)) {
                                                validate49.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                return false;
                                            }
                                        }
                                    }
                                    var valid0 = _errs30 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.temporality_preference !== undefined) {
                                        let data13 = data.temporality_preference;
                                        const _errs32 = errors;
                                        if ((typeof data13 !== "string") && (data13 !== null)) {
                                            validate49.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/type", keyword: "type", params: { type: schema62.type }, message: "must be string,null" }];
                                            return false;
                                        }
                                        if (!(((data13 === "cumulative") || (data13 === "delta")) || (data13 === "low_memory"))) {
                                            validate49.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/enum", keyword: "enum", params: { allowedValues: schema62.enum }, message: "must be equal to one of the allowed values" }];
                                            return false;
                                        }
                                        var valid0 = _errs32 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                    if (valid0) {
                                        if (data.default_histogram_aggregation !== undefined) {
                                            let data14 = data.default_histogram_aggregation;
                                            const _errs35 = errors;
                                            if ((typeof data14 !== "string") && (data14 !== null)) {
                                                validate49.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/type", keyword: "type", params: { type: schema63.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            if (!((data14 === "explicit_bucket_histogram") || (data14 === "base2_exponential_bucket_histogram"))) {
                                                validate49.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/enum", keyword: "enum", params: { allowedValues: schema63.enum }, message: "must be equal to one of the allowed values" }];
                                                return false;
                                            }
                                            var valid0 = _errs35 === errors;
                                        }
                                        else {
                                            var valid0 = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} validate49.errors = vErrors; return errors === 0; }
validate49.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema69 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "output_stream": { "type": ["string", "null"], "description": "Configure output stream. \nValues include stdout, or scheme+destination. For example: file:///path/to/file.jsonl.\nIf omitted or null, stdout is used.\n" }, "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } };
function validate51(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate51.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate51.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema69.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(((key0 === "output_stream") || (key0 === "temporality_preference")) || (key0 === "default_histogram_aggregation"))) {
                validate51.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.output_stream !== undefined) {
                let data0 = data.output_stream;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate51.errors = [{ instancePath: instancePath + "/output_stream", schemaPath: "#/properties/output_stream/type", keyword: "type", params: { type: schema69.properties.output_stream.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.temporality_preference !== undefined) {
                    let data1 = data.temporality_preference;
                    const _errs4 = errors;
                    if ((typeof data1 !== "string") && (data1 !== null)) {
                        validate51.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/type", keyword: "type", params: { type: schema62.type }, message: "must be string,null" }];
                        return false;
                    }
                    if (!(((data1 === "cumulative") || (data1 === "delta")) || (data1 === "low_memory"))) {
                        validate51.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/enum", keyword: "enum", params: { allowedValues: schema62.enum }, message: "must be equal to one of the allowed values" }];
                        return false;
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.default_histogram_aggregation !== undefined) {
                        let data2 = data.default_histogram_aggregation;
                        const _errs7 = errors;
                        if ((typeof data2 !== "string") && (data2 !== null)) {
                            validate51.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/type", keyword: "type", params: { type: schema63.type }, message: "must be string,null" }];
                            return false;
                        }
                        if (!((data2 === "explicit_bucket_histogram") || (data2 === "base2_exponential_bucket_histogram"))) {
                            validate51.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/enum", keyword: "enum", params: { allowedValues: schema63.enum }, message: "must be equal to one of the allowed values" }];
                            return false;
                        }
                        var valid0 = _errs7 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                }
            }
        }
    }
} validate51.errors = vErrors; return errors === 0; }
validate51.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema72 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "temporality_preference": { "$ref": "#/$defs/ExporterTemporalityPreference", "description": "Configure temporality preference.\nValues include:\n* cumulative: Use cumulative aggregation temporality for all instrument types.\n* delta: Use delta aggregation for all instrument types except up down counter and asynchronous up down counter.\n* low_memory: Use delta aggregation temporality for counter and histogram instrument types. Use cumulative aggregation temporality for all other instrument types.\nIf omitted, cumulative is used.\n" }, "default_histogram_aggregation": { "$ref": "#/$defs/ExporterDefaultHistogramAggregation", "description": "Configure default histogram aggregation.\nValues include:\n* base2_exponential_bucket_histogram: Use base2 exponential histogram as the default aggregation for histogram instruments.\n* explicit_bucket_histogram: Use explicit bucket histogram as the default aggregation for histogram instruments.\nIf omitted, explicit_bucket_histogram is used.\n" } } };
function validate53(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate53.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate53.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema72.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((key0 === "temporality_preference") || (key0 === "default_histogram_aggregation"))) {
                validate53.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.temporality_preference !== undefined) {
                let data0 = data.temporality_preference;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate53.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/type", keyword: "type", params: { type: schema62.type }, message: "must be string,null" }];
                    return false;
                }
                if (!(((data0 === "cumulative") || (data0 === "delta")) || (data0 === "low_memory"))) {
                    validate53.errors = [{ instancePath: instancePath + "/temporality_preference", schemaPath: "#/$defs/ExporterTemporalityPreference/enum", keyword: "enum", params: { allowedValues: schema62.enum }, message: "must be equal to one of the allowed values" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.default_histogram_aggregation !== undefined) {
                    let data1 = data.default_histogram_aggregation;
                    const _errs5 = errors;
                    if ((typeof data1 !== "string") && (data1 !== null)) {
                        validate53.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/type", keyword: "type", params: { type: schema63.type }, message: "must be string,null" }];
                        return false;
                    }
                    if (!((data1 === "explicit_bucket_histogram") || (data1 === "base2_exponential_bucket_histogram"))) {
                        validate53.errors = [{ instancePath: instancePath + "/default_histogram_aggregation", schemaPath: "#/$defs/ExporterDefaultHistogramAggregation/enum", keyword: "enum", params: { allowedValues: schema63.enum }, message: "must be equal to one of the allowed values" }];
                        return false;
                    }
                    var valid0 = _errs5 === errors;
                }
                else {
                    var valid0 = true;
                }
            }
        }
    }
} validate53.errors = vErrors; return errors === 0; }
validate53.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate46(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate46.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate46.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate46.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((((key0 === "otlp_http") || (key0 === "otlp_grpc")) || (key0 === "otlp_file/development")) || (key0 === "console"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate46.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema57.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.otlp_http !== undefined) {
                        const _errs4 = errors;
                        if (!(validate47(data.otlp_http, { instancePath: instancePath + "/otlp_http", parentData: data, parentDataProperty: "otlp_http", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate47.errors : vErrors.concat(validate47.errors);
                            errors = vErrors.length;
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.otlp_grpc !== undefined) {
                            const _errs5 = errors;
                            if (!(validate49(data.otlp_grpc, { instancePath: instancePath + "/otlp_grpc", parentData: data, parentDataProperty: "otlp_grpc", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate49.errors : vErrors.concat(validate49.errors);
                                errors = vErrors.length;
                            }
                            var valid1 = _errs5 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data["otlp_file/development"] !== undefined) {
                                const _errs6 = errors;
                                if (!(validate51(data["otlp_file/development"], { instancePath: instancePath + "/otlp_file~1development", parentData: data, parentDataProperty: "otlp_file/development", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate51.errors : vErrors.concat(validate51.errors);
                                    errors = vErrors.length;
                                }
                                var valid1 = _errs6 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                            if (valid1) {
                                if (data.console !== undefined) {
                                    const _errs7 = errors;
                                    if (!(validate53(data.console, { instancePath: instancePath + "/console", parentData: data, parentDataProperty: "console", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid1 = _errs7 === errors;
                                }
                                else {
                                    var valid1 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate46.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate46.errors = vErrors; return errors === 0; }
validate46.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema75 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "opencensus": { "$ref": "#/$defs/OpenCensusMetricProducer", "description": "Configure metric producer to be opencensus.\nIf omitted, ignore.\n" } } };
const schema76 = { "type": ["object", "null"], "additionalProperties": false };
function validate56(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate56.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate56.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate56.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!(key0 === "opencensus")) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate56.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema75.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.opencensus !== undefined) {
                        let data1 = data.opencensus;
                        const _errs5 = errors;
                        if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                            validate56.errors = [{ instancePath: instancePath + "/opencensus", schemaPath: "#/$defs/OpenCensusMetricProducer/type", keyword: "type", params: { type: schema76.type }, message: "must be object,null" }];
                            return false;
                        }
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                for (const key1 in data1) {
                                    validate56.errors = [{ instancePath: instancePath + "/opencensus", schemaPath: "#/$defs/OpenCensusMetricProducer/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate56.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate56.errors = vErrors; return errors === 0; }
validate56.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate45(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate45.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.exporter === undefined) && (missing0 = "exporter")) {
            validate45.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!((((((key0 === "interval") || (key0 === "timeout")) || (key0 === "max_export_batch_size/development")) || (key0 === "exporter")) || (key0 === "producers")) || (key0 === "cardinality_limits"))) {
                    validate45.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.interval !== undefined) {
                    let data0 = data.interval;
                    const _errs2 = errors;
                    if ((!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))) && (data0 !== null)) {
                        validate45.errors = [{ instancePath: instancePath + "/interval", schemaPath: "#/properties/interval/type", keyword: "type", params: { type: schema56.properties.interval.type }, message: "must be integer,null" }];
                        return false;
                    }
                    if (errors === _errs2) {
                        if (typeof data0 == "number") {
                            if (data0 < 0 || isNaN(data0)) {
                                validate45.errors = [{ instancePath: instancePath + "/interval", schemaPath: "#/properties/interval/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                return false;
                            }
                        }
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.timeout !== undefined) {
                        let data1 = data.timeout;
                        const _errs4 = errors;
                        if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                            validate45.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/type", keyword: "type", params: { type: schema56.properties.timeout.type }, message: "must be integer,null" }];
                            return false;
                        }
                        if (errors === _errs4) {
                            if (typeof data1 == "number") {
                                if (data1 < 0 || isNaN(data1)) {
                                    validate45.errors = [{ instancePath: instancePath + "/timeout", schemaPath: "#/properties/timeout/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                    return false;
                                }
                            }
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data["max_export_batch_size/development"] !== undefined) {
                            let data2 = data["max_export_batch_size/development"];
                            const _errs6 = errors;
                            if ((!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))) && (data2 !== null)) {
                                validate45.errors = [{ instancePath: instancePath + "/max_export_batch_size~1development", schemaPath: "#/properties/max_export_batch_size~1development/type", keyword: "type", params: { type: schema56.properties["max_export_batch_size/development"].type }, message: "must be integer,null" }];
                                return false;
                            }
                            if (errors === _errs6) {
                                if (typeof data2 == "number") {
                                    if (data2 < 1 || isNaN(data2)) {
                                        validate45.errors = [{ instancePath: instancePath + "/max_export_batch_size~1development", schemaPath: "#/properties/max_export_batch_size~1development/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                                        return false;
                                    }
                                }
                            }
                            var valid0 = _errs6 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.exporter !== undefined) {
                                const _errs8 = errors;
                                if (!(validate46(data.exporter, { instancePath: instancePath + "/exporter", parentData: data, parentDataProperty: "exporter", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate46.errors : vErrors.concat(validate46.errors);
                                    errors = vErrors.length;
                                }
                                var valid0 = _errs8 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.producers !== undefined) {
                                    let data4 = data.producers;
                                    const _errs9 = errors;
                                    if (errors === _errs9) {
                                        if (Array.isArray(data4)) {
                                            if (data4.length < 1) {
                                                validate45.errors = [{ instancePath: instancePath + "/producers", schemaPath: "#/properties/producers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                return false;
                                            }
                                            else {
                                                var valid1 = true;
                                                const len0 = data4.length;
                                                for (let i0 = 0; i0 < len0; i0++) {
                                                    const _errs11 = errors;
                                                    if (!(validate56(data4[i0], { instancePath: instancePath + "/producers/" + i0, parentData: data4, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                                        vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
                                                        errors = vErrors.length;
                                                    }
                                                    var valid1 = _errs11 === errors;
                                                    if (!valid1) {
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        else {
                                            validate45.errors = [{ instancePath: instancePath + "/producers", schemaPath: "#/properties/producers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                            return false;
                                        }
                                    }
                                    var valid0 = _errs9 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.cardinality_limits !== undefined) {
                                        let data6 = data.cardinality_limits;
                                        const _errs12 = errors;
                                        const _errs13 = errors;
                                        if (errors === _errs13) {
                                            if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
                                                const _errs15 = errors;
                                                for (const key1 in data6) {
                                                    if (!((((((((key1 === "default") || (key1 === "counter")) || (key1 === "gauge")) || (key1 === "histogram")) || (key1 === "observable_counter")) || (key1 === "observable_gauge")) || (key1 === "observable_up_down_counter")) || (key1 === "up_down_counter"))) {
                                                        validate45.errors = [{ instancePath: instancePath + "/cardinality_limits", schemaPath: "#/$defs/CardinalityLimits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                                        return false;
                                                        break;
                                                    }
                                                }
                                                if (_errs15 === errors) {
                                                    if (data6.default !== undefined) {
                                                        let data7 = data6.default;
                                                        const _errs16 = errors;
                                                        if ((!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))) && (data7 !== null)) {
                                                            validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/default", schemaPath: "#/$defs/CardinalityLimits/properties/default/type", keyword: "type", params: { type: schema77.properties.default.type }, message: "must be integer,null" }];
                                                            return false;
                                                        }
                                                        if (errors === _errs16) {
                                                            if (typeof data7 == "number") {
                                                                if (data7 <= 0 || isNaN(data7)) {
                                                                    validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/default", schemaPath: "#/$defs/CardinalityLimits/properties/default/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                    return false;
                                                                }
                                                            }
                                                        }
                                                        var valid3 = _errs16 === errors;
                                                    }
                                                    else {
                                                        var valid3 = true;
                                                    }
                                                    if (valid3) {
                                                        if (data6.counter !== undefined) {
                                                            let data8 = data6.counter;
                                                            const _errs18 = errors;
                                                            if ((!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))) && (data8 !== null)) {
                                                                validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/counter", schemaPath: "#/$defs/CardinalityLimits/properties/counter/type", keyword: "type", params: { type: schema77.properties.counter.type }, message: "must be integer,null" }];
                                                                return false;
                                                            }
                                                            if (errors === _errs18) {
                                                                if (typeof data8 == "number") {
                                                                    if (data8 <= 0 || isNaN(data8)) {
                                                                        validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/counter", schemaPath: "#/$defs/CardinalityLimits/properties/counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                        return false;
                                                                    }
                                                                }
                                                            }
                                                            var valid3 = _errs18 === errors;
                                                        }
                                                        else {
                                                            var valid3 = true;
                                                        }
                                                        if (valid3) {
                                                            if (data6.gauge !== undefined) {
                                                                let data9 = data6.gauge;
                                                                const _errs20 = errors;
                                                                if ((!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))) && (data9 !== null)) {
                                                                    validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/gauge", schemaPath: "#/$defs/CardinalityLimits/properties/gauge/type", keyword: "type", params: { type: schema77.properties.gauge.type }, message: "must be integer,null" }];
                                                                    return false;
                                                                }
                                                                if (errors === _errs20) {
                                                                    if (typeof data9 == "number") {
                                                                        if (data9 <= 0 || isNaN(data9)) {
                                                                            validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/gauge", schemaPath: "#/$defs/CardinalityLimits/properties/gauge/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                            return false;
                                                                        }
                                                                    }
                                                                }
                                                                var valid3 = _errs20 === errors;
                                                            }
                                                            else {
                                                                var valid3 = true;
                                                            }
                                                            if (valid3) {
                                                                if (data6.histogram !== undefined) {
                                                                    let data10 = data6.histogram;
                                                                    const _errs22 = errors;
                                                                    if ((!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))) && (data10 !== null)) {
                                                                        validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/histogram", schemaPath: "#/$defs/CardinalityLimits/properties/histogram/type", keyword: "type", params: { type: schema77.properties.histogram.type }, message: "must be integer,null" }];
                                                                        return false;
                                                                    }
                                                                    if (errors === _errs22) {
                                                                        if (typeof data10 == "number") {
                                                                            if (data10 <= 0 || isNaN(data10)) {
                                                                                validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/histogram", schemaPath: "#/$defs/CardinalityLimits/properties/histogram/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                                return false;
                                                                            }
                                                                        }
                                                                    }
                                                                    var valid3 = _errs22 === errors;
                                                                }
                                                                else {
                                                                    var valid3 = true;
                                                                }
                                                                if (valid3) {
                                                                    if (data6.observable_counter !== undefined) {
                                                                        let data11 = data6.observable_counter;
                                                                        const _errs24 = errors;
                                                                        if ((!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))) && (data11 !== null)) {
                                                                            validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_counter/type", keyword: "type", params: { type: schema77.properties.observable_counter.type }, message: "must be integer,null" }];
                                                                            return false;
                                                                        }
                                                                        if (errors === _errs24) {
                                                                            if (typeof data11 == "number") {
                                                                                if (data11 <= 0 || isNaN(data11)) {
                                                                                    validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                                    return false;
                                                                                }
                                                                            }
                                                                        }
                                                                        var valid3 = _errs24 === errors;
                                                                    }
                                                                    else {
                                                                        var valid3 = true;
                                                                    }
                                                                    if (valid3) {
                                                                        if (data6.observable_gauge !== undefined) {
                                                                            let data12 = data6.observable_gauge;
                                                                            const _errs26 = errors;
                                                                            if ((!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))) && (data12 !== null)) {
                                                                                validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_gauge", schemaPath: "#/$defs/CardinalityLimits/properties/observable_gauge/type", keyword: "type", params: { type: schema77.properties.observable_gauge.type }, message: "must be integer,null" }];
                                                                                return false;
                                                                            }
                                                                            if (errors === _errs26) {
                                                                                if (typeof data12 == "number") {
                                                                                    if (data12 <= 0 || isNaN(data12)) {
                                                                                        validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_gauge", schemaPath: "#/$defs/CardinalityLimits/properties/observable_gauge/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                                        return false;
                                                                                    }
                                                                                }
                                                                            }
                                                                            var valid3 = _errs26 === errors;
                                                                        }
                                                                        else {
                                                                            var valid3 = true;
                                                                        }
                                                                        if (valid3) {
                                                                            if (data6.observable_up_down_counter !== undefined) {
                                                                                let data13 = data6.observable_up_down_counter;
                                                                                const _errs28 = errors;
                                                                                if ((!((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13)))) && (data13 !== null)) {
                                                                                    validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_up_down_counter/type", keyword: "type", params: { type: schema77.properties.observable_up_down_counter.type }, message: "must be integer,null" }];
                                                                                    return false;
                                                                                }
                                                                                if (errors === _errs28) {
                                                                                    if (typeof data13 == "number") {
                                                                                        if (data13 <= 0 || isNaN(data13)) {
                                                                                            validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_up_down_counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                                            return false;
                                                                                        }
                                                                                    }
                                                                                }
                                                                                var valid3 = _errs28 === errors;
                                                                            }
                                                                            else {
                                                                                var valid3 = true;
                                                                            }
                                                                            if (valid3) {
                                                                                if (data6.up_down_counter !== undefined) {
                                                                                    let data14 = data6.up_down_counter;
                                                                                    const _errs30 = errors;
                                                                                    if ((!((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14)))) && (data14 !== null)) {
                                                                                        validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/up_down_counter/type", keyword: "type", params: { type: schema77.properties.up_down_counter.type }, message: "must be integer,null" }];
                                                                                        return false;
                                                                                    }
                                                                                    if (errors === _errs30) {
                                                                                        if (typeof data14 == "number") {
                                                                                            if (data14 <= 0 || isNaN(data14)) {
                                                                                                validate45.errors = [{ instancePath: instancePath + "/cardinality_limits/up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/up_down_counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                                                return false;
                                                                                            }
                                                                                        }
                                                                                    }
                                                                                    var valid3 = _errs30 === errors;
                                                                                }
                                                                                else {
                                                                                    var valid3 = true;
                                                                                }
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                validate45.errors = [{ instancePath: instancePath + "/cardinality_limits", schemaPath: "#/$defs/CardinalityLimits/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                return false;
                                            }
                                        }
                                        var valid0 = _errs12 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate45.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate45.errors = vErrors; return errors === 0; }
validate45.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema78 = { "type": "object", "additionalProperties": false, "properties": { "exporter": { "$ref": "#/$defs/PullMetricExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" }, "producers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/MetricProducer" }, "description": "Configure metric producers.\nIf omitted, no metric producers are added.\n" }, "cardinality_limits": { "$ref": "#/$defs/CardinalityLimits", "description": "Configure cardinality limits.\nIf omitted, default values as described in CardinalityLimits are used.\n" } }, "required": ["exporter"] };
const schema79 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "prometheus/development": { "$ref": "#/$defs/ExperimentalPrometheusMetricExporter", "description": "Configure exporter to be prometheus.\nIf omitted, ignore.\n" } } };
const schema80 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "host": { "type": ["string", "null"], "description": "Configure host.\nIf omitted or null, localhost is used.\n" }, "port": { "type": ["integer", "null"], "description": "Configure port.\nIf omitted or null, 9464 is used.\n" }, "scope_info_enabled": { "type": ["boolean", "null"], "description": "Configure Prometheus Exporter to produce metrics with scope labels.\nIf omitted or null, true is used.\n" }, "target_info_enabled/development": { "type": ["boolean", "null"], "description": "Configure Prometheus Exporter to produce metrics with a target info metric for the resource.\nIf omitted or null, true is used.\n" }, "resource_constant_labels": { "$ref": "#/$defs/IncludeExclude", "description": "Configure Prometheus Exporter to add resource attributes as metrics attributes, where the resource attribute keys match the patterns.\nIf omitted, no resource attributes are added.\n" }, "translation_strategy": { "$ref": "#/$defs/ExperimentalPrometheusTranslationStrategy", "description": "Configure how metric names are translated to Prometheus metric names.\nValues include:\n* no_translation/development: Special character escaping is disabled. Type and unit suffixes are disabled. Metric names are unaltered.\n* no_utf8_escaping_with_suffixes/development: Special character escaping is disabled. Type and unit suffixes are enabled.\n* underscore_escaping_with_suffixes: Special character escaping is enabled. Type and unit suffixes are enabled.\n* underscore_escaping_without_suffixes/development: Special character escaping is enabled. Type and unit suffixes are disabled. This represents classic Prometheus metric name compatibility.\nIf omitted, underscore_escaping_with_suffixes is used.\n" } } };
const schema81 = { "type": "object", "additionalProperties": false, "properties": { "included": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to include.\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, all values are included.\n" }, "excluded": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to exclude. Applies after .included (i.e. excluded has higher priority than included).\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, .included attributes are included.\n" } } };
const schema82 = { "type": ["string", "null"], "enum": ["underscore_escaping_with_suffixes", "underscore_escaping_without_suffixes/development", "no_utf8_escaping_with_suffixes/development", "no_translation/development"] };
function validate61(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate61.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate61.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema80.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((((((key0 === "host") || (key0 === "port")) || (key0 === "scope_info_enabled")) || (key0 === "target_info_enabled/development")) || (key0 === "resource_constant_labels")) || (key0 === "translation_strategy"))) {
                validate61.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.host !== undefined) {
                let data0 = data.host;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate61.errors = [{ instancePath: instancePath + "/host", schemaPath: "#/properties/host/type", keyword: "type", params: { type: schema80.properties.host.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.port !== undefined) {
                    let data1 = data.port;
                    const _errs4 = errors;
                    if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                        validate61.errors = [{ instancePath: instancePath + "/port", schemaPath: "#/properties/port/type", keyword: "type", params: { type: schema80.properties.port.type }, message: "must be integer,null" }];
                        return false;
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.scope_info_enabled !== undefined) {
                        let data2 = data.scope_info_enabled;
                        const _errs6 = errors;
                        if ((typeof data2 !== "boolean") && (data2 !== null)) {
                            validate61.errors = [{ instancePath: instancePath + "/scope_info_enabled", schemaPath: "#/properties/scope_info_enabled/type", keyword: "type", params: { type: schema80.properties.scope_info_enabled.type }, message: "must be boolean,null" }];
                            return false;
                        }
                        var valid0 = _errs6 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data["target_info_enabled/development"] !== undefined) {
                            let data3 = data["target_info_enabled/development"];
                            const _errs8 = errors;
                            if ((typeof data3 !== "boolean") && (data3 !== null)) {
                                validate61.errors = [{ instancePath: instancePath + "/target_info_enabled~1development", schemaPath: "#/properties/target_info_enabled~1development/type", keyword: "type", params: { type: schema80.properties["target_info_enabled/development"].type }, message: "must be boolean,null" }];
                                return false;
                            }
                            var valid0 = _errs8 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.resource_constant_labels !== undefined) {
                                let data4 = data.resource_constant_labels;
                                const _errs10 = errors;
                                const _errs11 = errors;
                                if (errors === _errs11) {
                                    if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                                        const _errs13 = errors;
                                        for (const key1 in data4) {
                                            if (!((key1 === "included") || (key1 === "excluded"))) {
                                                validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels", schemaPath: "#/$defs/IncludeExclude/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                        if (_errs13 === errors) {
                                            if (data4.included !== undefined) {
                                                let data5 = data4.included;
                                                const _errs14 = errors;
                                                if (errors === _errs14) {
                                                    if (Array.isArray(data5)) {
                                                        if (data5.length < 1) {
                                                            validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels/included", schemaPath: "#/$defs/IncludeExclude/properties/included/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                            return false;
                                                        }
                                                        else {
                                                            var valid3 = true;
                                                            const len0 = data5.length;
                                                            for (let i0 = 0; i0 < len0; i0++) {
                                                                const _errs16 = errors;
                                                                if (typeof data5[i0] !== "string") {
                                                                    validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels/included/" + i0, schemaPath: "#/$defs/IncludeExclude/properties/included/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                    return false;
                                                                }
                                                                var valid3 = _errs16 === errors;
                                                                if (!valid3) {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels/included", schemaPath: "#/$defs/IncludeExclude/properties/included/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                        return false;
                                                    }
                                                }
                                                var valid2 = _errs14 === errors;
                                            }
                                            else {
                                                var valid2 = true;
                                            }
                                            if (valid2) {
                                                if (data4.excluded !== undefined) {
                                                    let data7 = data4.excluded;
                                                    const _errs18 = errors;
                                                    if (errors === _errs18) {
                                                        if (Array.isArray(data7)) {
                                                            if (data7.length < 1) {
                                                                validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels/excluded", schemaPath: "#/$defs/IncludeExclude/properties/excluded/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                                return false;
                                                            }
                                                            else {
                                                                var valid4 = true;
                                                                const len1 = data7.length;
                                                                for (let i1 = 0; i1 < len1; i1++) {
                                                                    const _errs20 = errors;
                                                                    if (typeof data7[i1] !== "string") {
                                                                        validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels/excluded/" + i1, schemaPath: "#/$defs/IncludeExclude/properties/excluded/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                        return false;
                                                                    }
                                                                    var valid4 = _errs20 === errors;
                                                                    if (!valid4) {
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        else {
                                                            validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels/excluded", schemaPath: "#/$defs/IncludeExclude/properties/excluded/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                            return false;
                                                        }
                                                    }
                                                    var valid2 = _errs18 === errors;
                                                }
                                                else {
                                                    var valid2 = true;
                                                }
                                            }
                                        }
                                    }
                                    else {
                                        validate61.errors = [{ instancePath: instancePath + "/resource_constant_labels", schemaPath: "#/$defs/IncludeExclude/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                        return false;
                                    }
                                }
                                var valid0 = _errs10 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.translation_strategy !== undefined) {
                                    let data9 = data.translation_strategy;
                                    const _errs22 = errors;
                                    if ((typeof data9 !== "string") && (data9 !== null)) {
                                        validate61.errors = [{ instancePath: instancePath + "/translation_strategy", schemaPath: "#/$defs/ExperimentalPrometheusTranslationStrategy/type", keyword: "type", params: { type: schema82.type }, message: "must be string,null" }];
                                        return false;
                                    }
                                    if (!((((data9 === "underscore_escaping_with_suffixes") || (data9 === "underscore_escaping_without_suffixes/development")) || (data9 === "no_utf8_escaping_with_suffixes/development")) || (data9 === "no_translation/development"))) {
                                        validate61.errors = [{ instancePath: instancePath + "/translation_strategy", schemaPath: "#/$defs/ExperimentalPrometheusTranslationStrategy/enum", keyword: "enum", params: { allowedValues: schema82.enum }, message: "must be equal to one of the allowed values" }];
                                        return false;
                                    }
                                    var valid0 = _errs22 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} validate61.errors = vErrors; return errors === 0; }
validate61.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate60(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate60.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate60.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate60.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!(key0 === "prometheus/development")) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate60.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema79.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data["prometheus/development"] !== undefined) {
                        if (!(validate61(data["prometheus/development"], { instancePath: instancePath + "/prometheus~1development", parentData: data, parentDataProperty: "prometheus/development", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
                            errors = vErrors.length;
                        }
                    }
                }
            }
        }
    }
    else {
        validate60.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate60.errors = vErrors; return errors === 0; }
validate60.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate59(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate59.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.exporter === undefined) && (missing0 = "exporter")) {
            validate59.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((key0 === "exporter") || (key0 === "producers")) || (key0 === "cardinality_limits"))) {
                    validate59.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.exporter !== undefined) {
                    const _errs2 = errors;
                    if (!(validate60(data.exporter, { instancePath: instancePath + "/exporter", parentData: data, parentDataProperty: "exporter", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
                        errors = vErrors.length;
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.producers !== undefined) {
                        let data1 = data.producers;
                        const _errs3 = errors;
                        if (errors === _errs3) {
                            if (Array.isArray(data1)) {
                                if (data1.length < 1) {
                                    validate59.errors = [{ instancePath: instancePath + "/producers", schemaPath: "#/properties/producers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                    return false;
                                }
                                else {
                                    var valid1 = true;
                                    const len0 = data1.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                        const _errs5 = errors;
                                        if (!(validate56(data1[i0], { instancePath: instancePath + "/producers/" + i0, parentData: data1, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                            vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
                                            errors = vErrors.length;
                                        }
                                        var valid1 = _errs5 === errors;
                                        if (!valid1) {
                                            break;
                                        }
                                    }
                                }
                            }
                            else {
                                validate59.errors = [{ instancePath: instancePath + "/producers", schemaPath: "#/properties/producers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                return false;
                            }
                        }
                        var valid0 = _errs3 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.cardinality_limits !== undefined) {
                            let data3 = data.cardinality_limits;
                            const _errs6 = errors;
                            const _errs7 = errors;
                            if (errors === _errs7) {
                                if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                    const _errs9 = errors;
                                    for (const key1 in data3) {
                                        if (!((((((((key1 === "default") || (key1 === "counter")) || (key1 === "gauge")) || (key1 === "histogram")) || (key1 === "observable_counter")) || (key1 === "observable_gauge")) || (key1 === "observable_up_down_counter")) || (key1 === "up_down_counter"))) {
                                            validate59.errors = [{ instancePath: instancePath + "/cardinality_limits", schemaPath: "#/$defs/CardinalityLimits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                            return false;
                                            break;
                                        }
                                    }
                                    if (_errs9 === errors) {
                                        if (data3.default !== undefined) {
                                            let data4 = data3.default;
                                            const _errs10 = errors;
                                            if ((!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))) && (data4 !== null)) {
                                                validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/default", schemaPath: "#/$defs/CardinalityLimits/properties/default/type", keyword: "type", params: { type: schema77.properties.default.type }, message: "must be integer,null" }];
                                                return false;
                                            }
                                            if (errors === _errs10) {
                                                if (typeof data4 == "number") {
                                                    if (data4 <= 0 || isNaN(data4)) {
                                                        validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/default", schemaPath: "#/$defs/CardinalityLimits/properties/default/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                        return false;
                                                    }
                                                }
                                            }
                                            var valid3 = _errs10 === errors;
                                        }
                                        else {
                                            var valid3 = true;
                                        }
                                        if (valid3) {
                                            if (data3.counter !== undefined) {
                                                let data5 = data3.counter;
                                                const _errs12 = errors;
                                                if ((!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))) && (data5 !== null)) {
                                                    validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/counter", schemaPath: "#/$defs/CardinalityLimits/properties/counter/type", keyword: "type", params: { type: schema77.properties.counter.type }, message: "must be integer,null" }];
                                                    return false;
                                                }
                                                if (errors === _errs12) {
                                                    if (typeof data5 == "number") {
                                                        if (data5 <= 0 || isNaN(data5)) {
                                                            validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/counter", schemaPath: "#/$defs/CardinalityLimits/properties/counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                            return false;
                                                        }
                                                    }
                                                }
                                                var valid3 = _errs12 === errors;
                                            }
                                            else {
                                                var valid3 = true;
                                            }
                                            if (valid3) {
                                                if (data3.gauge !== undefined) {
                                                    let data6 = data3.gauge;
                                                    const _errs14 = errors;
                                                    if ((!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))) && (data6 !== null)) {
                                                        validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/gauge", schemaPath: "#/$defs/CardinalityLimits/properties/gauge/type", keyword: "type", params: { type: schema77.properties.gauge.type }, message: "must be integer,null" }];
                                                        return false;
                                                    }
                                                    if (errors === _errs14) {
                                                        if (typeof data6 == "number") {
                                                            if (data6 <= 0 || isNaN(data6)) {
                                                                validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/gauge", schemaPath: "#/$defs/CardinalityLimits/properties/gauge/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                return false;
                                                            }
                                                        }
                                                    }
                                                    var valid3 = _errs14 === errors;
                                                }
                                                else {
                                                    var valid3 = true;
                                                }
                                                if (valid3) {
                                                    if (data3.histogram !== undefined) {
                                                        let data7 = data3.histogram;
                                                        const _errs16 = errors;
                                                        if ((!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))) && (data7 !== null)) {
                                                            validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/histogram", schemaPath: "#/$defs/CardinalityLimits/properties/histogram/type", keyword: "type", params: { type: schema77.properties.histogram.type }, message: "must be integer,null" }];
                                                            return false;
                                                        }
                                                        if (errors === _errs16) {
                                                            if (typeof data7 == "number") {
                                                                if (data7 <= 0 || isNaN(data7)) {
                                                                    validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/histogram", schemaPath: "#/$defs/CardinalityLimits/properties/histogram/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                    return false;
                                                                }
                                                            }
                                                        }
                                                        var valid3 = _errs16 === errors;
                                                    }
                                                    else {
                                                        var valid3 = true;
                                                    }
                                                    if (valid3) {
                                                        if (data3.observable_counter !== undefined) {
                                                            let data8 = data3.observable_counter;
                                                            const _errs18 = errors;
                                                            if ((!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))) && (data8 !== null)) {
                                                                validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_counter/type", keyword: "type", params: { type: schema77.properties.observable_counter.type }, message: "must be integer,null" }];
                                                                return false;
                                                            }
                                                            if (errors === _errs18) {
                                                                if (typeof data8 == "number") {
                                                                    if (data8 <= 0 || isNaN(data8)) {
                                                                        validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                        return false;
                                                                    }
                                                                }
                                                            }
                                                            var valid3 = _errs18 === errors;
                                                        }
                                                        else {
                                                            var valid3 = true;
                                                        }
                                                        if (valid3) {
                                                            if (data3.observable_gauge !== undefined) {
                                                                let data9 = data3.observable_gauge;
                                                                const _errs20 = errors;
                                                                if ((!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))) && (data9 !== null)) {
                                                                    validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_gauge", schemaPath: "#/$defs/CardinalityLimits/properties/observable_gauge/type", keyword: "type", params: { type: schema77.properties.observable_gauge.type }, message: "must be integer,null" }];
                                                                    return false;
                                                                }
                                                                if (errors === _errs20) {
                                                                    if (typeof data9 == "number") {
                                                                        if (data9 <= 0 || isNaN(data9)) {
                                                                            validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_gauge", schemaPath: "#/$defs/CardinalityLimits/properties/observable_gauge/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                            return false;
                                                                        }
                                                                    }
                                                                }
                                                                var valid3 = _errs20 === errors;
                                                            }
                                                            else {
                                                                var valid3 = true;
                                                            }
                                                            if (valid3) {
                                                                if (data3.observable_up_down_counter !== undefined) {
                                                                    let data10 = data3.observable_up_down_counter;
                                                                    const _errs22 = errors;
                                                                    if ((!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))) && (data10 !== null)) {
                                                                        validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_up_down_counter/type", keyword: "type", params: { type: schema77.properties.observable_up_down_counter.type }, message: "must be integer,null" }];
                                                                        return false;
                                                                    }
                                                                    if (errors === _errs22) {
                                                                        if (typeof data10 == "number") {
                                                                            if (data10 <= 0 || isNaN(data10)) {
                                                                                validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/observable_up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/observable_up_down_counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                                return false;
                                                                            }
                                                                        }
                                                                    }
                                                                    var valid3 = _errs22 === errors;
                                                                }
                                                                else {
                                                                    var valid3 = true;
                                                                }
                                                                if (valid3) {
                                                                    if (data3.up_down_counter !== undefined) {
                                                                        let data11 = data3.up_down_counter;
                                                                        const _errs24 = errors;
                                                                        if ((!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))) && (data11 !== null)) {
                                                                            validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/up_down_counter/type", keyword: "type", params: { type: schema77.properties.up_down_counter.type }, message: "must be integer,null" }];
                                                                            return false;
                                                                        }
                                                                        if (errors === _errs24) {
                                                                            if (typeof data11 == "number") {
                                                                                if (data11 <= 0 || isNaN(data11)) {
                                                                                    validate59.errors = [{ instancePath: instancePath + "/cardinality_limits/up_down_counter", schemaPath: "#/$defs/CardinalityLimits/properties/up_down_counter/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                                                                    return false;
                                                                                }
                                                                            }
                                                                        }
                                                                        var valid3 = _errs24 === errors;
                                                                    }
                                                                    else {
                                                                        var valid3 = true;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                else {
                                    validate59.errors = [{ instancePath: instancePath + "/cardinality_limits", schemaPath: "#/$defs/CardinalityLimits/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                    return false;
                                }
                            }
                            var valid0 = _errs6 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                    }
                }
            }
        }
    }
    else {
        validate59.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate59.errors = vErrors; return errors === 0; }
validate59.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate44(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate44.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate44.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate44.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((key0 === "periodic") || (key0 === "pull"))) {
                        validate44.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                        return false;
                        break;
                    }
                }
                if (_errs1 === errors) {
                    if (data.periodic !== undefined) {
                        const _errs2 = errors;
                        if (!(validate45(data.periodic, { instancePath: instancePath + "/periodic", parentData: data, parentDataProperty: "periodic", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
                            errors = vErrors.length;
                        }
                        var valid0 = _errs2 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.pull !== undefined) {
                            const _errs3 = errors;
                            if (!(validate59(data.pull, { instancePath: instancePath + "/pull", parentData: data, parentDataProperty: "pull", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate59.errors : vErrors.concat(validate59.errors);
                                errors = vErrors.length;
                            }
                            var valid0 = _errs3 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                    }
                }
            }
        }
    }
    else {
        validate44.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate44.errors = vErrors; return errors === 0; }
validate44.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema84 = { "type": "object", "additionalProperties": false, "properties": { "selector": { "$ref": "#/$defs/ViewSelector", "description": "Configure view selector. \nSelection criteria is additive as described in https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#instrument-selection-criteria.\nProperty is required and must be non-null.\n" }, "stream": { "$ref": "#/$defs/ViewStream", "description": "Configure view stream.\nProperty is required and must be non-null.\n" } }, "required": ["selector", "stream"] };
const schema85 = { "type": "object", "additionalProperties": false, "properties": { "instrument_name": { "type": ["string", "null"], "description": "Configure instrument name selection criteria.\nIf omitted or null, all instrument names match.\n" }, "instrument_type": { "$ref": "#/$defs/InstrumentType", "description": "Configure instrument type selection criteria.\nValues include:\n* counter: Synchronous counter instruments.\n* gauge: Synchronous gauge instruments.\n* histogram: Synchronous histogram instruments.\n* observable_counter: Asynchronous counter instruments.\n* observable_gauge: Asynchronous gauge instruments.\n* observable_up_down_counter: Asynchronous up down counter instruments.\n* up_down_counter: Synchronous up down counter instruments.\nIf omitted, all instrument types match.\n" }, "unit": { "type": ["string", "null"], "description": "Configure the instrument unit selection criteria.\nIf omitted or null, all instrument units match.\n" }, "meter_name": { "type": ["string", "null"], "description": "Configure meter name selection criteria.\nIf omitted or null, all meter names match.\n" }, "meter_version": { "type": ["string", "null"], "description": "Configure meter version selection criteria.\nIf omitted or null, all meter versions match.\n" }, "meter_schema_url": { "type": ["string", "null"], "description": "Configure meter schema url selection criteria.\nIf omitted or null, all meter schema URLs match.\n" } } };
const schema86 = { "type": ["string", "null"], "enum": ["counter", "gauge", "histogram", "observable_counter", "observable_gauge", "observable_up_down_counter", "up_down_counter"] };
function validate68(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate68.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((((((key0 === "instrument_name") || (key0 === "instrument_type")) || (key0 === "unit")) || (key0 === "meter_name")) || (key0 === "meter_version")) || (key0 === "meter_schema_url"))) {
                validate68.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.instrument_name !== undefined) {
                let data0 = data.instrument_name;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate68.errors = [{ instancePath: instancePath + "/instrument_name", schemaPath: "#/properties/instrument_name/type", keyword: "type", params: { type: schema85.properties.instrument_name.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.instrument_type !== undefined) {
                    let data1 = data.instrument_type;
                    const _errs4 = errors;
                    if ((typeof data1 !== "string") && (data1 !== null)) {
                        validate68.errors = [{ instancePath: instancePath + "/instrument_type", schemaPath: "#/$defs/InstrumentType/type", keyword: "type", params: { type: schema86.type }, message: "must be string,null" }];
                        return false;
                    }
                    if (!(((((((data1 === "counter") || (data1 === "gauge")) || (data1 === "histogram")) || (data1 === "observable_counter")) || (data1 === "observable_gauge")) || (data1 === "observable_up_down_counter")) || (data1 === "up_down_counter"))) {
                        validate68.errors = [{ instancePath: instancePath + "/instrument_type", schemaPath: "#/$defs/InstrumentType/enum", keyword: "enum", params: { allowedValues: schema86.enum }, message: "must be equal to one of the allowed values" }];
                        return false;
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.unit !== undefined) {
                        let data2 = data.unit;
                        const _errs7 = errors;
                        if ((typeof data2 !== "string") && (data2 !== null)) {
                            validate68.errors = [{ instancePath: instancePath + "/unit", schemaPath: "#/properties/unit/type", keyword: "type", params: { type: schema85.properties.unit.type }, message: "must be string,null" }];
                            return false;
                        }
                        var valid0 = _errs7 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.meter_name !== undefined) {
                            let data3 = data.meter_name;
                            const _errs9 = errors;
                            if ((typeof data3 !== "string") && (data3 !== null)) {
                                validate68.errors = [{ instancePath: instancePath + "/meter_name", schemaPath: "#/properties/meter_name/type", keyword: "type", params: { type: schema85.properties.meter_name.type }, message: "must be string,null" }];
                                return false;
                            }
                            var valid0 = _errs9 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.meter_version !== undefined) {
                                let data4 = data.meter_version;
                                const _errs11 = errors;
                                if ((typeof data4 !== "string") && (data4 !== null)) {
                                    validate68.errors = [{ instancePath: instancePath + "/meter_version", schemaPath: "#/properties/meter_version/type", keyword: "type", params: { type: schema85.properties.meter_version.type }, message: "must be string,null" }];
                                    return false;
                                }
                                var valid0 = _errs11 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.meter_schema_url !== undefined) {
                                    let data5 = data.meter_schema_url;
                                    const _errs13 = errors;
                                    if ((typeof data5 !== "string") && (data5 !== null)) {
                                        validate68.errors = [{ instancePath: instancePath + "/meter_schema_url", schemaPath: "#/properties/meter_schema_url/type", keyword: "type", params: { type: schema85.properties.meter_schema_url.type }, message: "must be string,null" }];
                                        return false;
                                    }
                                    var valid0 = _errs13 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate68.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate68.errors = vErrors; return errors === 0; }
validate68.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema87 = { "type": "object", "additionalProperties": false, "properties": { "name": { "type": ["string", "null"], "description": "Configure metric name of the resulting stream(s).\nIf omitted or null, the instrument's original name is used.\n" }, "description": { "type": ["string", "null"], "description": "Configure metric description of the resulting stream(s).\nIf omitted or null, the instrument's origin description is used.\n" }, "aggregation": { "$ref": "#/$defs/Aggregation", "description": "Configure aggregation of the resulting stream(s).\nIf omitted, default is used.\n" }, "aggregation_cardinality_limit": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure the aggregation cardinality limit.\nIf omitted or null, the metric reader's default cardinality limit is used.\n" }, "attribute_keys": { "$ref": "#/$defs/IncludeExclude", "description": "Configure attribute keys retained in the resulting stream(s).\nIf omitted, all attribute keys are retained.\n" } } };
const schema88 = { "type": "object", "additionalProperties": false, "minProperties": 1, "maxProperties": 1, "properties": { "default": { "$ref": "#/$defs/DefaultAggregation", "description": "Configures the stream to use the instrument kind to select an aggregation and advisory parameters to influence aggregation configuration parameters. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#default-aggregation for details.\nIf omitted, ignore.\n" }, "drop": { "$ref": "#/$defs/DropAggregation", "description": "Configures the stream to ignore/drop all instrument measurements. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#drop-aggregation for details.\nIf omitted, ignore.\n" }, "explicit_bucket_histogram": { "$ref": "#/$defs/ExplicitBucketHistogramAggregation", "description": "Configures the stream to collect data for the histogram metric point using a set of explicit boundary values for histogram bucketing. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#explicit-bucket-histogram-aggregation for details\nIf omitted, ignore.\n" }, "base2_exponential_bucket_histogram": { "$ref": "#/$defs/Base2ExponentialBucketHistogramAggregation", "description": "Configures the stream to collect data for the exponential histogram metric point, which uses a base-2 exponential formula to determine bucket boundaries and an integer scale parameter to control resolution. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#base2-exponential-bucket-histogram-aggregation for details.\nIf omitted, ignore.\n" }, "last_value": { "$ref": "#/$defs/LastValueAggregation", "description": "Configures the stream to collect data using the last measurement. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#last-value-aggregation for details.\nIf omitted, ignore.\n" }, "sum": { "$ref": "#/$defs/SumAggregation", "description": "Configures the stream to collect the arithmetic sum of measurement values. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#sum-aggregation for details.\nIf omitted, ignore.\n" } } };
const schema89 = { "type": ["object", "null"], "additionalProperties": false };
const schema90 = { "type": ["object", "null"], "additionalProperties": false };
const schema91 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "boundaries": { "type": "array", "minItems": 0, "items": { "type": "number" }, "description": "Configure bucket boundaries.\nIf omitted, [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000] is used.\n" }, "record_min_max": { "type": ["boolean", "null"], "description": "Configure record min and max.\nIf omitted or null, true is used.\n" } } };
const schema92 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "max_scale": { "type": ["integer", "null"], "minimum": -10, "maximum": 20, "description": "Configure the max scale factor.\nIf omitted or null, 20 is used.\n" }, "max_size": { "type": ["integer", "null"], "minimum": 2, "description": "Configure the maximum number of buckets in each of the positive and negative ranges, not counting the special zero bucket.\nIf omitted or null, 160 is used.\n" }, "record_min_max": { "type": ["boolean", "null"], "description": "Configure whether or not to record min and max.\nIf omitted or null, true is used.\n" } } };
const schema93 = { "type": ["object", "null"], "additionalProperties": false };
const schema94 = { "type": ["object", "null"], "additionalProperties": false };
function validate71(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate71.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate71.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate71.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((((((key0 === "default") || (key0 === "drop")) || (key0 === "explicit_bucket_histogram")) || (key0 === "base2_exponential_bucket_histogram")) || (key0 === "last_value")) || (key0 === "sum"))) {
                        validate71.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                        return false;
                        break;
                    }
                }
                if (_errs1 === errors) {
                    if (data.default !== undefined) {
                        let data0 = data.default;
                        const _errs2 = errors;
                        const _errs3 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate71.errors = [{ instancePath: instancePath + "/default", schemaPath: "#/$defs/DefaultAggregation/type", keyword: "type", params: { type: schema89.type }, message: "must be object,null" }];
                            return false;
                        }
                        if (errors === _errs3) {
                            if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                                for (const key1 in data0) {
                                    validate71.errors = [{ instancePath: instancePath + "/default", schemaPath: "#/$defs/DefaultAggregation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                        }
                        var valid0 = _errs2 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.drop !== undefined) {
                            let data1 = data.drop;
                            const _errs6 = errors;
                            const _errs7 = errors;
                            if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                                validate71.errors = [{ instancePath: instancePath + "/drop", schemaPath: "#/$defs/DropAggregation/type", keyword: "type", params: { type: schema90.type }, message: "must be object,null" }];
                                return false;
                            }
                            if (errors === _errs7) {
                                if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                    for (const key2 in data1) {
                                        validate71.errors = [{ instancePath: instancePath + "/drop", schemaPath: "#/$defs/DropAggregation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                            }
                            var valid0 = _errs6 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.explicit_bucket_histogram !== undefined) {
                                let data2 = data.explicit_bucket_histogram;
                                const _errs10 = errors;
                                const _errs11 = errors;
                                if ((!(data2 && typeof data2 == "object" && !Array.isArray(data2))) && (data2 !== null)) {
                                    validate71.errors = [{ instancePath: instancePath + "/explicit_bucket_histogram", schemaPath: "#/$defs/ExplicitBucketHistogramAggregation/type", keyword: "type", params: { type: schema91.type }, message: "must be object,null" }];
                                    return false;
                                }
                                if (errors === _errs11) {
                                    if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                                        const _errs13 = errors;
                                        for (const key3 in data2) {
                                            if (!((key3 === "boundaries") || (key3 === "record_min_max"))) {
                                                validate71.errors = [{ instancePath: instancePath + "/explicit_bucket_histogram", schemaPath: "#/$defs/ExplicitBucketHistogramAggregation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                        if (_errs13 === errors) {
                                            if (data2.boundaries !== undefined) {
                                                let data3 = data2.boundaries;
                                                const _errs14 = errors;
                                                if (errors === _errs14) {
                                                    if (Array.isArray(data3)) {
                                                        if (data3.length < 0) {
                                                            validate71.errors = [{ instancePath: instancePath + "/explicit_bucket_histogram/boundaries", schemaPath: "#/$defs/ExplicitBucketHistogramAggregation/properties/boundaries/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" }];
                                                            return false;
                                                        }
                                                        else {
                                                            var valid5 = true;
                                                            const len0 = data3.length;
                                                            for (let i0 = 0; i0 < len0; i0++) {
                                                                const _errs16 = errors;
                                                                if (!(typeof data3[i0] == "number")) {
                                                                    validate71.errors = [{ instancePath: instancePath + "/explicit_bucket_histogram/boundaries/" + i0, schemaPath: "#/$defs/ExplicitBucketHistogramAggregation/properties/boundaries/items/type", keyword: "type", params: { type: "number" }, message: "must be number" }];
                                                                    return false;
                                                                }
                                                                var valid5 = _errs16 === errors;
                                                                if (!valid5) {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        validate71.errors = [{ instancePath: instancePath + "/explicit_bucket_histogram/boundaries", schemaPath: "#/$defs/ExplicitBucketHistogramAggregation/properties/boundaries/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                        return false;
                                                    }
                                                }
                                                var valid4 = _errs14 === errors;
                                            }
                                            else {
                                                var valid4 = true;
                                            }
                                            if (valid4) {
                                                if (data2.record_min_max !== undefined) {
                                                    let data5 = data2.record_min_max;
                                                    const _errs18 = errors;
                                                    if ((typeof data5 !== "boolean") && (data5 !== null)) {
                                                        validate71.errors = [{ instancePath: instancePath + "/explicit_bucket_histogram/record_min_max", schemaPath: "#/$defs/ExplicitBucketHistogramAggregation/properties/record_min_max/type", keyword: "type", params: { type: schema91.properties.record_min_max.type }, message: "must be boolean,null" }];
                                                        return false;
                                                    }
                                                    var valid4 = _errs18 === errors;
                                                }
                                                else {
                                                    var valid4 = true;
                                                }
                                            }
                                        }
                                    }
                                }
                                var valid0 = _errs10 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.base2_exponential_bucket_histogram !== undefined) {
                                    let data6 = data.base2_exponential_bucket_histogram;
                                    const _errs20 = errors;
                                    const _errs21 = errors;
                                    if ((!(data6 && typeof data6 == "object" && !Array.isArray(data6))) && (data6 !== null)) {
                                        validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/type", keyword: "type", params: { type: schema92.type }, message: "must be object,null" }];
                                        return false;
                                    }
                                    if (errors === _errs21) {
                                        if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
                                            const _errs23 = errors;
                                            for (const key4 in data6) {
                                                if (!(((key4 === "max_scale") || (key4 === "max_size")) || (key4 === "record_min_max"))) {
                                                    validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" }];
                                                    return false;
                                                    break;
                                                }
                                            }
                                            if (_errs23 === errors) {
                                                if (data6.max_scale !== undefined) {
                                                    let data7 = data6.max_scale;
                                                    const _errs24 = errors;
                                                    if ((!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))) && (data7 !== null)) {
                                                        validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram/max_scale", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/properties/max_scale/type", keyword: "type", params: { type: schema92.properties.max_scale.type }, message: "must be integer,null" }];
                                                        return false;
                                                    }
                                                    if (errors === _errs24) {
                                                        if (typeof data7 == "number") {
                                                            if (data7 > 20 || isNaN(data7)) {
                                                                validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram/max_scale", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/properties/max_scale/maximum", keyword: "maximum", params: { comparison: "<=", limit: 20 }, message: "must be <= 20" }];
                                                                return false;
                                                            }
                                                            else {
                                                                if (data7 < -10 || isNaN(data7)) {
                                                                    validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram/max_scale", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/properties/max_scale/minimum", keyword: "minimum", params: { comparison: ">=", limit: -10 }, message: "must be >= -10" }];
                                                                    return false;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    var valid7 = _errs24 === errors;
                                                }
                                                else {
                                                    var valid7 = true;
                                                }
                                                if (valid7) {
                                                    if (data6.max_size !== undefined) {
                                                        let data8 = data6.max_size;
                                                        const _errs26 = errors;
                                                        if ((!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))) && (data8 !== null)) {
                                                            validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram/max_size", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/properties/max_size/type", keyword: "type", params: { type: schema92.properties.max_size.type }, message: "must be integer,null" }];
                                                            return false;
                                                        }
                                                        if (errors === _errs26) {
                                                            if (typeof data8 == "number") {
                                                                if (data8 < 2 || isNaN(data8)) {
                                                                    validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram/max_size", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/properties/max_size/minimum", keyword: "minimum", params: { comparison: ">=", limit: 2 }, message: "must be >= 2" }];
                                                                    return false;
                                                                }
                                                            }
                                                        }
                                                        var valid7 = _errs26 === errors;
                                                    }
                                                    else {
                                                        var valid7 = true;
                                                    }
                                                    if (valid7) {
                                                        if (data6.record_min_max !== undefined) {
                                                            let data9 = data6.record_min_max;
                                                            const _errs28 = errors;
                                                            if ((typeof data9 !== "boolean") && (data9 !== null)) {
                                                                validate71.errors = [{ instancePath: instancePath + "/base2_exponential_bucket_histogram/record_min_max", schemaPath: "#/$defs/Base2ExponentialBucketHistogramAggregation/properties/record_min_max/type", keyword: "type", params: { type: schema92.properties.record_min_max.type }, message: "must be boolean,null" }];
                                                                return false;
                                                            }
                                                            var valid7 = _errs28 === errors;
                                                        }
                                                        else {
                                                            var valid7 = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    var valid0 = _errs20 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.last_value !== undefined) {
                                        let data10 = data.last_value;
                                        const _errs30 = errors;
                                        const _errs31 = errors;
                                        if ((!(data10 && typeof data10 == "object" && !Array.isArray(data10))) && (data10 !== null)) {
                                            validate71.errors = [{ instancePath: instancePath + "/last_value", schemaPath: "#/$defs/LastValueAggregation/type", keyword: "type", params: { type: schema93.type }, message: "must be object,null" }];
                                            return false;
                                        }
                                        if (errors === _errs31) {
                                            if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
                                                for (const key5 in data10) {
                                                    validate71.errors = [{ instancePath: instancePath + "/last_value", schemaPath: "#/$defs/LastValueAggregation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" }];
                                                    return false;
                                                    break;
                                                }
                                            }
                                        }
                                        var valid0 = _errs30 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                    if (valid0) {
                                        if (data.sum !== undefined) {
                                            let data11 = data.sum;
                                            const _errs34 = errors;
                                            const _errs35 = errors;
                                            if ((!(data11 && typeof data11 == "object" && !Array.isArray(data11))) && (data11 !== null)) {
                                                validate71.errors = [{ instancePath: instancePath + "/sum", schemaPath: "#/$defs/SumAggregation/type", keyword: "type", params: { type: schema94.type }, message: "must be object,null" }];
                                                return false;
                                            }
                                            if (errors === _errs35) {
                                                if (data11 && typeof data11 == "object" && !Array.isArray(data11)) {
                                                    for (const key6 in data11) {
                                                        validate71.errors = [{ instancePath: instancePath + "/sum", schemaPath: "#/$defs/SumAggregation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" }];
                                                        return false;
                                                        break;
                                                    }
                                                }
                                            }
                                            var valid0 = _errs34 === errors;
                                        }
                                        else {
                                            var valid0 = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate71.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate71.errors = vErrors; return errors === 0; }
validate71.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate70(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate70.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(((((key0 === "name") || (key0 === "description")) || (key0 === "aggregation")) || (key0 === "aggregation_cardinality_limit")) || (key0 === "attribute_keys"))) {
                validate70.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.name !== undefined) {
                let data0 = data.name;
                const _errs2 = errors;
                if ((typeof data0 !== "string") && (data0 !== null)) {
                    validate70.errors = [{ instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: schema87.properties.name.type }, message: "must be string,null" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.description !== undefined) {
                    let data1 = data.description;
                    const _errs4 = errors;
                    if ((typeof data1 !== "string") && (data1 !== null)) {
                        validate70.errors = [{ instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: schema87.properties.description.type }, message: "must be string,null" }];
                        return false;
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.aggregation !== undefined) {
                        const _errs6 = errors;
                        if (!(validate71(data.aggregation, { instancePath: instancePath + "/aggregation", parentData: data, parentDataProperty: "aggregation", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate71.errors : vErrors.concat(validate71.errors);
                            errors = vErrors.length;
                        }
                        var valid0 = _errs6 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.aggregation_cardinality_limit !== undefined) {
                            let data3 = data.aggregation_cardinality_limit;
                            const _errs7 = errors;
                            if ((!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))) && (data3 !== null)) {
                                validate70.errors = [{ instancePath: instancePath + "/aggregation_cardinality_limit", schemaPath: "#/properties/aggregation_cardinality_limit/type", keyword: "type", params: { type: schema87.properties.aggregation_cardinality_limit.type }, message: "must be integer,null" }];
                                return false;
                            }
                            if (errors === _errs7) {
                                if (typeof data3 == "number") {
                                    if (data3 <= 0 || isNaN(data3)) {
                                        validate70.errors = [{ instancePath: instancePath + "/aggregation_cardinality_limit", schemaPath: "#/properties/aggregation_cardinality_limit/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                        return false;
                                    }
                                }
                            }
                            var valid0 = _errs7 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.attribute_keys !== undefined) {
                                let data4 = data.attribute_keys;
                                const _errs9 = errors;
                                const _errs10 = errors;
                                if (errors === _errs10) {
                                    if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                                        const _errs12 = errors;
                                        for (const key1 in data4) {
                                            if (!((key1 === "included") || (key1 === "excluded"))) {
                                                validate70.errors = [{ instancePath: instancePath + "/attribute_keys", schemaPath: "#/$defs/IncludeExclude/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                        if (_errs12 === errors) {
                                            if (data4.included !== undefined) {
                                                let data5 = data4.included;
                                                const _errs13 = errors;
                                                if (errors === _errs13) {
                                                    if (Array.isArray(data5)) {
                                                        if (data5.length < 1) {
                                                            validate70.errors = [{ instancePath: instancePath + "/attribute_keys/included", schemaPath: "#/$defs/IncludeExclude/properties/included/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                            return false;
                                                        }
                                                        else {
                                                            var valid3 = true;
                                                            const len0 = data5.length;
                                                            for (let i0 = 0; i0 < len0; i0++) {
                                                                const _errs15 = errors;
                                                                if (typeof data5[i0] !== "string") {
                                                                    validate70.errors = [{ instancePath: instancePath + "/attribute_keys/included/" + i0, schemaPath: "#/$defs/IncludeExclude/properties/included/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                    return false;
                                                                }
                                                                var valid3 = _errs15 === errors;
                                                                if (!valid3) {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        validate70.errors = [{ instancePath: instancePath + "/attribute_keys/included", schemaPath: "#/$defs/IncludeExclude/properties/included/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                        return false;
                                                    }
                                                }
                                                var valid2 = _errs13 === errors;
                                            }
                                            else {
                                                var valid2 = true;
                                            }
                                            if (valid2) {
                                                if (data4.excluded !== undefined) {
                                                    let data7 = data4.excluded;
                                                    const _errs17 = errors;
                                                    if (errors === _errs17) {
                                                        if (Array.isArray(data7)) {
                                                            if (data7.length < 1) {
                                                                validate70.errors = [{ instancePath: instancePath + "/attribute_keys/excluded", schemaPath: "#/$defs/IncludeExclude/properties/excluded/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                                return false;
                                                            }
                                                            else {
                                                                var valid4 = true;
                                                                const len1 = data7.length;
                                                                for (let i1 = 0; i1 < len1; i1++) {
                                                                    const _errs19 = errors;
                                                                    if (typeof data7[i1] !== "string") {
                                                                        validate70.errors = [{ instancePath: instancePath + "/attribute_keys/excluded/" + i1, schemaPath: "#/$defs/IncludeExclude/properties/excluded/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                        return false;
                                                                    }
                                                                    var valid4 = _errs19 === errors;
                                                                    if (!valid4) {
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        else {
                                                            validate70.errors = [{ instancePath: instancePath + "/attribute_keys/excluded", schemaPath: "#/$defs/IncludeExclude/properties/excluded/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                            return false;
                                                        }
                                                    }
                                                    var valid2 = _errs17 === errors;
                                                }
                                                else {
                                                    var valid2 = true;
                                                }
                                            }
                                        }
                                    }
                                    else {
                                        validate70.errors = [{ instancePath: instancePath + "/attribute_keys", schemaPath: "#/$defs/IncludeExclude/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                        return false;
                                    }
                                }
                                var valid0 = _errs9 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate70.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate70.errors = vErrors; return errors === 0; }
validate70.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate67(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate67.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if (((data.selector === undefined) && (missing0 = "selector")) || ((data.stream === undefined) && (missing0 = "stream"))) {
            validate67.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!((key0 === "selector") || (key0 === "stream"))) {
                    validate67.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.selector !== undefined) {
                    const _errs2 = errors;
                    if (!(validate68(data.selector, { instancePath: instancePath + "/selector", parentData: data, parentDataProperty: "selector", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
                        errors = vErrors.length;
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.stream !== undefined) {
                        const _errs3 = errors;
                        if (!(validate70(data.stream, { instancePath: instancePath + "/stream", parentData: data, parentDataProperty: "stream", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate70.errors : vErrors.concat(validate70.errors);
                            errors = vErrors.length;
                        }
                        var valid0 = _errs3 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                }
            }
        }
    }
    else {
        validate67.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate67.errors = vErrors; return errors === 0; }
validate67.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema97 = { "type": ["object"], "additionalProperties": false, "properties": { "default_config": { "$ref": "#/$defs/ExperimentalMeterConfig", "description": "Configure the default meter config used there is no matching entry in .meter_configurator/development.meters.\nIf omitted, unmatched .meters use default values as described in ExperimentalMeterConfig.\n" }, "meters": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalMeterMatcherAndConfig" }, "description": "Configure meters.\nIf omitted, all meters used .default_config.\n" } } };
const schema98 = { "type": ["object"], "additionalProperties": false, "properties": { "enabled": { "type": ["boolean"], "description": "Configure if the meter is enabled or not.\nIf omitted, true is used.\n" } } };
const schema99 = { "type": ["object"], "additionalProperties": false, "properties": { "name": { "type": ["string"], "description": "Configure meter names to match. Matching is case-sensitive, evaluated as follows:\n\n * If the meter name exactly matches.\n * If the meter name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nProperty is required and must be non-null.\n" }, "config": { "$ref": "#/$defs/ExperimentalMeterConfig", "description": "The meter config.\nProperty is required and must be non-null.\n" } }, "required": ["name", "config"] };
function validate76(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate76.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if (((data.name === undefined) && (missing0 = "name")) || ((data.config === undefined) && (missing0 = "config"))) {
            validate76.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!((key0 === "name") || (key0 === "config"))) {
                    validate76.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.name !== undefined) {
                    const _errs2 = errors;
                    if (typeof data.name !== "string") {
                        validate76.errors = [{ instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: schema99.properties.name.type }, message: "must be string" }];
                        return false;
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.config !== undefined) {
                        let data1 = data.config;
                        const _errs4 = errors;
                        const _errs5 = errors;
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                const _errs7 = errors;
                                for (const key1 in data1) {
                                    if (!(key1 === "enabled")) {
                                        validate76.errors = [{ instancePath: instancePath + "/config", schemaPath: "#/$defs/ExperimentalMeterConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                                if (_errs7 === errors) {
                                    if (data1.enabled !== undefined) {
                                        if (typeof data1.enabled !== "boolean") {
                                            validate76.errors = [{ instancePath: instancePath + "/config/enabled", schemaPath: "#/$defs/ExperimentalMeterConfig/properties/enabled/type", keyword: "type", params: { type: schema98.properties.enabled.type }, message: "must be boolean" }];
                                            return false;
                                        }
                                    }
                                }
                            }
                            else {
                                validate76.errors = [{ instancePath: instancePath + "/config", schemaPath: "#/$defs/ExperimentalMeterConfig/type", keyword: "type", params: { type: schema98.type }, message: "must be object" }];
                                return false;
                            }
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                }
            }
        }
    }
    else {
        validate76.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema99.type }, message: "must be object" }];
        return false;
    }
} validate76.errors = vErrors; return errors === 0; }
validate76.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate75(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate75.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((key0 === "default_config") || (key0 === "meters"))) {
                validate75.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.default_config !== undefined) {
                let data0 = data.default_config;
                const _errs2 = errors;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(key1 === "enabled")) {
                                validate75.errors = [{ instancePath: instancePath + "/default_config", schemaPath: "#/$defs/ExperimentalMeterConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.enabled !== undefined) {
                                if (typeof data0.enabled !== "boolean") {
                                    validate75.errors = [{ instancePath: instancePath + "/default_config/enabled", schemaPath: "#/$defs/ExperimentalMeterConfig/properties/enabled/type", keyword: "type", params: { type: schema98.properties.enabled.type }, message: "must be boolean" }];
                                    return false;
                                }
                            }
                        }
                    }
                    else {
                        validate75.errors = [{ instancePath: instancePath + "/default_config", schemaPath: "#/$defs/ExperimentalMeterConfig/type", keyword: "type", params: { type: schema98.type }, message: "must be object" }];
                        return false;
                    }
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.meters !== undefined) {
                    let data2 = data.meters;
                    const _errs8 = errors;
                    if (errors === _errs8) {
                        if (Array.isArray(data2)) {
                            if (data2.length < 1) {
                                validate75.errors = [{ instancePath: instancePath + "/meters", schemaPath: "#/properties/meters/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                return false;
                            }
                            else {
                                var valid3 = true;
                                const len0 = data2.length;
                                for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs10 = errors;
                                    if (!(validate76(data2[i0], { instancePath: instancePath + "/meters/" + i0, parentData: data2, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid3 = _errs10 === errors;
                                    if (!valid3) {
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            validate75.errors = [{ instancePath: instancePath + "/meters", schemaPath: "#/properties/meters/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                        }
                    }
                    var valid0 = _errs8 === errors;
                }
                else {
                    var valid0 = true;
                }
            }
        }
    }
    else {
        validate75.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema97.type }, message: "must be object" }];
        return false;
    }
} validate75.errors = vErrors; return errors === 0; }
validate75.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate43(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate43.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.readers === undefined) && (missing0 = "readers")) {
            validate43.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!((((key0 === "readers") || (key0 === "views")) || (key0 === "exemplar_filter")) || (key0 === "meter_configurator/development"))) {
                    validate43.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.readers !== undefined) {
                    let data0 = data.readers;
                    const _errs2 = errors;
                    if (errors === _errs2) {
                        if (Array.isArray(data0)) {
                            if (data0.length < 1) {
                                validate43.errors = [{ instancePath: instancePath + "/readers", schemaPath: "#/properties/readers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                return false;
                            }
                            else {
                                var valid1 = true;
                                const len0 = data0.length;
                                for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs4 = errors;
                                    if (!(validate44(data0[i0], { instancePath: instancePath + "/readers/" + i0, parentData: data0, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate44.errors : vErrors.concat(validate44.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid1 = _errs4 === errors;
                                    if (!valid1) {
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            validate43.errors = [{ instancePath: instancePath + "/readers", schemaPath: "#/properties/readers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                        }
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.views !== undefined) {
                        let data2 = data.views;
                        const _errs5 = errors;
                        if (errors === _errs5) {
                            if (Array.isArray(data2)) {
                                if (data2.length < 1) {
                                    validate43.errors = [{ instancePath: instancePath + "/views", schemaPath: "#/properties/views/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                    return false;
                                }
                                else {
                                    var valid2 = true;
                                    const len1 = data2.length;
                                    for (let i1 = 0; i1 < len1; i1++) {
                                        const _errs7 = errors;
                                        if (!(validate67(data2[i1], { instancePath: instancePath + "/views/" + i1, parentData: data2, parentDataProperty: i1, rootData, dynamicAnchors }))) {
                                            vErrors = vErrors === null ? validate67.errors : vErrors.concat(validate67.errors);
                                            errors = vErrors.length;
                                        }
                                        var valid2 = _errs7 === errors;
                                        if (!valid2) {
                                            break;
                                        }
                                    }
                                }
                            }
                            else {
                                validate43.errors = [{ instancePath: instancePath + "/views", schemaPath: "#/properties/views/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                return false;
                            }
                        }
                        var valid0 = _errs5 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.exemplar_filter !== undefined) {
                            let data4 = data.exemplar_filter;
                            const _errs8 = errors;
                            if ((typeof data4 !== "string") && (data4 !== null)) {
                                validate43.errors = [{ instancePath: instancePath + "/exemplar_filter", schemaPath: "#/$defs/ExemplarFilter/type", keyword: "type", params: { type: schema96.type }, message: "must be string,null" }];
                                return false;
                            }
                            if (!(((data4 === "always_on") || (data4 === "always_off")) || (data4 === "trace_based"))) {
                                validate43.errors = [{ instancePath: instancePath + "/exemplar_filter", schemaPath: "#/$defs/ExemplarFilter/enum", keyword: "enum", params: { allowedValues: schema96.enum }, message: "must be equal to one of the allowed values" }];
                                return false;
                            }
                            var valid0 = _errs8 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data["meter_configurator/development"] !== undefined) {
                                const _errs11 = errors;
                                if (!(validate75(data["meter_configurator/development"], { instancePath: instancePath + "/meter_configurator~1development", parentData: data, parentDataProperty: "meter_configurator/development", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
                                    errors = vErrors.length;
                                }
                                var valid0 = _errs11 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate43.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate43.errors = vErrors; return errors === 0; }
validate43.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema101 = { "type": "object", "additionalProperties": false, "properties": { "composite": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/TextMapPropagator" }, "description": "Configure the propagators in the composite text map propagator. Entries from .composite_list are appended to the list here with duplicates filtered out.\nBuilt-in propagator keys include: tracecontext, baggage, b3, b3multi. Known third party keys include: xray.\nIf omitted, and .composite_list is omitted or null, a noop propagator is used.\n" }, "composite_list": { "type": ["string", "null"], "description": "Configure the propagators in the composite text map propagator. Entries are appended to .composite with duplicates filtered out.\nThe value is a comma separated list of propagator identifiers matching the format of OTEL_PROPAGATORS. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/configuration/sdk-environment-variables.md#general-sdk-configuration for details.\nBuilt-in propagator identifiers include: tracecontext, baggage, b3, b3multi. Known third party identifiers include: xray.\nIf omitted or null, and .composite is omitted or null, a noop propagator is used.\n" } } };
const schema102 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "tracecontext": { "$ref": "#/$defs/TraceContextPropagator", "description": "Include the w3c trace context propagator.\nIf omitted, ignore.\n" }, "baggage": { "$ref": "#/$defs/BaggagePropagator", "description": "Include the w3c baggage propagator.\nIf omitted, ignore.\n" }, "b3": { "$ref": "#/$defs/B3Propagator", "description": "Include the zipkin b3 propagator.\nIf omitted, ignore.\n" }, "b3multi": { "$ref": "#/$defs/B3MultiPropagator", "description": "Include the zipkin b3 multi propagator.\nIf omitted, ignore.\n" } } };
const schema103 = { "type": ["object", "null"], "additionalProperties": false };
const schema104 = { "type": ["object", "null"], "additionalProperties": false };
const schema105 = { "type": ["object", "null"], "additionalProperties": false };
const schema106 = { "type": ["object", "null"], "additionalProperties": false };
function validate81(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate81.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate81.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate81.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((((key0 === "tracecontext") || (key0 === "baggage")) || (key0 === "b3")) || (key0 === "b3multi"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate81.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema102.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.tracecontext !== undefined) {
                        let data1 = data.tracecontext;
                        const _errs4 = errors;
                        const _errs5 = errors;
                        if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                            validate81.errors = [{ instancePath: instancePath + "/tracecontext", schemaPath: "#/$defs/TraceContextPropagator/type", keyword: "type", params: { type: schema103.type }, message: "must be object,null" }];
                            return false;
                        }
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                for (const key1 in data1) {
                                    validate81.errors = [{ instancePath: instancePath + "/tracecontext", schemaPath: "#/$defs/TraceContextPropagator/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.baggage !== undefined) {
                            let data2 = data.baggage;
                            const _errs8 = errors;
                            const _errs9 = errors;
                            if ((!(data2 && typeof data2 == "object" && !Array.isArray(data2))) && (data2 !== null)) {
                                validate81.errors = [{ instancePath: instancePath + "/baggage", schemaPath: "#/$defs/BaggagePropagator/type", keyword: "type", params: { type: schema104.type }, message: "must be object,null" }];
                                return false;
                            }
                            if (errors === _errs9) {
                                if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                                    for (const key2 in data2) {
                                        validate81.errors = [{ instancePath: instancePath + "/baggage", schemaPath: "#/$defs/BaggagePropagator/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                            }
                            var valid1 = _errs8 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data.b3 !== undefined) {
                                let data3 = data.b3;
                                const _errs12 = errors;
                                const _errs13 = errors;
                                if ((!(data3 && typeof data3 == "object" && !Array.isArray(data3))) && (data3 !== null)) {
                                    validate81.errors = [{ instancePath: instancePath + "/b3", schemaPath: "#/$defs/B3Propagator/type", keyword: "type", params: { type: schema105.type }, message: "must be object,null" }];
                                    return false;
                                }
                                if (errors === _errs13) {
                                    if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                        for (const key3 in data3) {
                                            validate81.errors = [{ instancePath: instancePath + "/b3", schemaPath: "#/$defs/B3Propagator/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                                            return false;
                                            break;
                                        }
                                    }
                                }
                                var valid1 = _errs12 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                            if (valid1) {
                                if (data.b3multi !== undefined) {
                                    let data4 = data.b3multi;
                                    const _errs16 = errors;
                                    const _errs17 = errors;
                                    if ((!(data4 && typeof data4 == "object" && !Array.isArray(data4))) && (data4 !== null)) {
                                        validate81.errors = [{ instancePath: instancePath + "/b3multi", schemaPath: "#/$defs/B3MultiPropagator/type", keyword: "type", params: { type: schema106.type }, message: "must be object,null" }];
                                        return false;
                                    }
                                    if (errors === _errs17) {
                                        if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                                            for (const key4 in data4) {
                                                validate81.errors = [{ instancePath: instancePath + "/b3multi", schemaPath: "#/$defs/B3MultiPropagator/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                    }
                                    var valid1 = _errs16 === errors;
                                }
                                else {
                                    var valid1 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate81.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate81.errors = vErrors; return errors === 0; }
validate81.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate80(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate80.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((key0 === "composite") || (key0 === "composite_list"))) {
                validate80.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.composite !== undefined) {
                let data0 = data.composite;
                const _errs2 = errors;
                if (errors === _errs2) {
                    if (Array.isArray(data0)) {
                        if (data0.length < 1) {
                            validate80.errors = [{ instancePath: instancePath + "/composite", schemaPath: "#/properties/composite/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                            return false;
                        }
                        else {
                            var valid1 = true;
                            const len0 = data0.length;
                            for (let i0 = 0; i0 < len0; i0++) {
                                const _errs4 = errors;
                                if (!(validate81(data0[i0], { instancePath: instancePath + "/composite/" + i0, parentData: data0, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
                                    errors = vErrors.length;
                                }
                                var valid1 = _errs4 === errors;
                                if (!valid1) {
                                    break;
                                }
                            }
                        }
                    }
                    else {
                        validate80.errors = [{ instancePath: instancePath + "/composite", schemaPath: "#/properties/composite/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                        return false;
                    }
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.composite_list !== undefined) {
                    let data2 = data.composite_list;
                    const _errs5 = errors;
                    if ((typeof data2 !== "string") && (data2 !== null)) {
                        validate80.errors = [{ instancePath: instancePath + "/composite_list", schemaPath: "#/properties/composite_list/type", keyword: "type", params: { type: schema101.properties.composite_list.type }, message: "must be string,null" }];
                        return false;
                    }
                    var valid0 = _errs5 === errors;
                }
                else {
                    var valid0 = true;
                }
            }
        }
    }
    else {
        validate80.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate80.errors = vErrors; return errors === 0; }
validate80.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema107 = { "type": "object", "additionalProperties": false, "properties": { "processors": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/SpanProcessor" }, "description": "Configure span processors.\nProperty is required and must be non-null.\n" }, "limits": { "$ref": "#/$defs/SpanLimits", "description": "Configure span limits. See also attribute_limits.\nIf omitted, default values as described in SpanLimits are used.\n" }, "sampler": { "$ref": "#/$defs/Sampler", "description": "Configure the sampler.\nIf omitted, parent based sampler with a root of always_on is used.\n" }, "id_generator": { "$ref": "#/$defs/IdGenerator", "description": "Configure the trace and span ID generator.\nIf omitted, RandomIdGenerator is used.\n" }, "tracer_configurator/development": { "$ref": "#/$defs/ExperimentalTracerConfigurator", "description": "Configure tracers.\nIf omitted, all tracers use default values as described in ExperimentalTracerConfig.\n" } }, "required": ["processors"] };
const schema114 = { "type": "object", "additionalProperties": false, "properties": { "attribute_value_length_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute value size. Overrides .attribute_limits.attribute_value_length_limit. \nValue must be non-negative.\nIf omitted or null, there is no limit.\n" }, "attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attribute count. Overrides .attribute_limits.attribute_count_limit. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "event_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max span event count. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "link_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max span link count. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "event_attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attributes per span event. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" }, "link_attribute_count_limit": { "type": ["integer", "null"], "minimum": 0, "description": "Configure max attributes per span link. \nValue must be non-negative.\nIf omitted or null, 128 is used.\n" } } };
const schema108 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "batch": { "$ref": "#/$defs/BatchSpanProcessor", "description": "Configure a batch span processor.\nIf omitted, ignore.\n" }, "simple": { "$ref": "#/$defs/SimpleSpanProcessor", "description": "Configure a simple span processor.\nIf omitted, ignore.\n" } } };
const schema109 = { "type": "object", "additionalProperties": false, "properties": { "schedule_delay": { "type": ["integer", "null"], "minimum": 0, "description": "Configure delay interval (in milliseconds) between two consecutive exports. \nValue must be non-negative.\nIf omitted or null, 5000 is used.\n" }, "export_timeout": { "type": ["integer", "null"], "minimum": 0, "description": "Configure maximum allowed time (in milliseconds) to export data. \nValue must be non-negative. A value of 0 indicates no limit (infinity).\nIf omitted or null, 30000 is used.\n" }, "max_queue_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum queue size. Value must be positive.\nIf omitted or null, 2048 is used.\n" }, "max_export_batch_size": { "type": ["integer", "null"], "exclusiveMinimum": 0, "description": "Configure maximum batch size. Value must be positive.\nIf omitted or null, 512 is used.\n" }, "exporter": { "$ref": "#/$defs/SpanExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] };
const schema110 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "otlp_http": { "$ref": "#/$defs/OtlpHttpExporter", "description": "Configure exporter to be OTLP with HTTP transport.\nIf omitted, ignore.\n" }, "otlp_grpc": { "$ref": "#/$defs/OtlpGrpcExporter", "description": "Configure exporter to be OTLP with gRPC transport.\nIf omitted, ignore.\n" }, "otlp_file/development": { "$ref": "#/$defs/ExperimentalOtlpFileExporter", "description": "Configure exporter to be OTLP with file transport.\nIf omitted, ignore.\n" }, "console": { "$ref": "#/$defs/ConsoleExporter", "description": "Configure exporter to be console.\nIf omitted, ignore.\n" } } };
function validate87(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate87.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate87.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate87.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((((key0 === "otlp_http") || (key0 === "otlp_grpc")) || (key0 === "otlp_file/development")) || (key0 === "console"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate87.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema110.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.otlp_http !== undefined) {
                        const _errs4 = errors;
                        if (!(validate25(data.otlp_http, { instancePath: instancePath + "/otlp_http", parentData: data, parentDataProperty: "otlp_http", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
                            errors = vErrors.length;
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.otlp_grpc !== undefined) {
                            const _errs5 = errors;
                            if (!(validate27(data.otlp_grpc, { instancePath: instancePath + "/otlp_grpc", parentData: data, parentDataProperty: "otlp_grpc", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
                                errors = vErrors.length;
                            }
                            var valid1 = _errs5 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data["otlp_file/development"] !== undefined) {
                                let data3 = data["otlp_file/development"];
                                const _errs6 = errors;
                                const _errs7 = errors;
                                if ((!(data3 && typeof data3 == "object" && !Array.isArray(data3))) && (data3 !== null)) {
                                    validate87.errors = [{ instancePath: instancePath + "/otlp_file~1development", schemaPath: "#/$defs/ExperimentalOtlpFileExporter/type", keyword: "type", params: { type: schema45.type }, message: "must be object,null" }];
                                    return false;
                                }
                                if (errors === _errs7) {
                                    if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                        const _errs9 = errors;
                                        for (const key1 in data3) {
                                            if (!(key1 === "output_stream")) {
                                                validate87.errors = [{ instancePath: instancePath + "/otlp_file~1development", schemaPath: "#/$defs/ExperimentalOtlpFileExporter/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                        if (_errs9 === errors) {
                                            if (data3.output_stream !== undefined) {
                                                let data4 = data3.output_stream;
                                                if ((typeof data4 !== "string") && (data4 !== null)) {
                                                    validate87.errors = [{ instancePath: instancePath + "/otlp_file~1development/output_stream", schemaPath: "#/$defs/ExperimentalOtlpFileExporter/properties/output_stream/type", keyword: "type", params: { type: schema45.properties.output_stream.type }, message: "must be string,null" }];
                                                    return false;
                                                }
                                            }
                                        }
                                    }
                                }
                                var valid1 = _errs6 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                            if (valid1) {
                                if (data.console !== undefined) {
                                    let data5 = data.console;
                                    const _errs12 = errors;
                                    const _errs13 = errors;
                                    if ((!(data5 && typeof data5 == "object" && !Array.isArray(data5))) && (data5 !== null)) {
                                        validate87.errors = [{ instancePath: instancePath + "/console", schemaPath: "#/$defs/ConsoleExporter/type", keyword: "type", params: { type: schema46.type }, message: "must be object,null" }];
                                        return false;
                                    }
                                    if (errors === _errs13) {
                                        if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
                                            for (const key2 in data5) {
                                                validate87.errors = [{ instancePath: instancePath + "/console", schemaPath: "#/$defs/ConsoleExporter/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                    }
                                    var valid1 = _errs12 === errors;
                                }
                                else {
                                    var valid1 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate87.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate87.errors = vErrors; return errors === 0; }
validate87.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate86(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate86.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.exporter === undefined) && (missing0 = "exporter")) {
            validate86.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((((key0 === "schedule_delay") || (key0 === "export_timeout")) || (key0 === "max_queue_size")) || (key0 === "max_export_batch_size")) || (key0 === "exporter"))) {
                    validate86.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.schedule_delay !== undefined) {
                    let data0 = data.schedule_delay;
                    const _errs2 = errors;
                    if ((!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))) && (data0 !== null)) {
                        validate86.errors = [{ instancePath: instancePath + "/schedule_delay", schemaPath: "#/properties/schedule_delay/type", keyword: "type", params: { type: schema109.properties.schedule_delay.type }, message: "must be integer,null" }];
                        return false;
                    }
                    if (errors === _errs2) {
                        if (typeof data0 == "number") {
                            if (data0 < 0 || isNaN(data0)) {
                                validate86.errors = [{ instancePath: instancePath + "/schedule_delay", schemaPath: "#/properties/schedule_delay/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                return false;
                            }
                        }
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.export_timeout !== undefined) {
                        let data1 = data.export_timeout;
                        const _errs4 = errors;
                        if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                            validate86.errors = [{ instancePath: instancePath + "/export_timeout", schemaPath: "#/properties/export_timeout/type", keyword: "type", params: { type: schema109.properties.export_timeout.type }, message: "must be integer,null" }];
                            return false;
                        }
                        if (errors === _errs4) {
                            if (typeof data1 == "number") {
                                if (data1 < 0 || isNaN(data1)) {
                                    validate86.errors = [{ instancePath: instancePath + "/export_timeout", schemaPath: "#/properties/export_timeout/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                    return false;
                                }
                            }
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.max_queue_size !== undefined) {
                            let data2 = data.max_queue_size;
                            const _errs6 = errors;
                            if ((!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))) && (data2 !== null)) {
                                validate86.errors = [{ instancePath: instancePath + "/max_queue_size", schemaPath: "#/properties/max_queue_size/type", keyword: "type", params: { type: schema109.properties.max_queue_size.type }, message: "must be integer,null" }];
                                return false;
                            }
                            if (errors === _errs6) {
                                if (typeof data2 == "number") {
                                    if (data2 <= 0 || isNaN(data2)) {
                                        validate86.errors = [{ instancePath: instancePath + "/max_queue_size", schemaPath: "#/properties/max_queue_size/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                        return false;
                                    }
                                }
                            }
                            var valid0 = _errs6 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.max_export_batch_size !== undefined) {
                                let data3 = data.max_export_batch_size;
                                const _errs8 = errors;
                                if ((!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))) && (data3 !== null)) {
                                    validate86.errors = [{ instancePath: instancePath + "/max_export_batch_size", schemaPath: "#/properties/max_export_batch_size/type", keyword: "type", params: { type: schema109.properties.max_export_batch_size.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs8) {
                                    if (typeof data3 == "number") {
                                        if (data3 <= 0 || isNaN(data3)) {
                                            validate86.errors = [{ instancePath: instancePath + "/max_export_batch_size", schemaPath: "#/properties/max_export_batch_size/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid0 = _errs8 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.exporter !== undefined) {
                                    const _errs10 = errors;
                                    if (!(validate87(data.exporter, { instancePath: instancePath + "/exporter", parentData: data, parentDataProperty: "exporter", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate87.errors : vErrors.concat(validate87.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid0 = _errs10 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate86.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate86.errors = vErrors; return errors === 0; }
validate86.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema113 = { "type": "object", "additionalProperties": false, "properties": { "exporter": { "$ref": "#/$defs/SpanExporter", "description": "Configure exporter.\nProperty is required and must be non-null.\n" } }, "required": ["exporter"] };
function validate92(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate92.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.exporter === undefined) && (missing0 = "exporter")) {
            validate92.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(key0 === "exporter")) {
                    validate92.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.exporter !== undefined) {
                    if (!(validate87(data.exporter, { instancePath: instancePath + "/exporter", parentData: data, parentDataProperty: "exporter", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? validate87.errors : vErrors.concat(validate87.errors);
                        errors = vErrors.length;
                    }
                }
            }
        }
    }
    else {
        validate92.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate92.errors = vErrors; return errors === 0; }
validate92.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate85(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate85.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate85.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate85.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((key0 === "batch") || (key0 === "simple"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate85.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema108.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.batch !== undefined) {
                        const _errs4 = errors;
                        if (!(validate86(data.batch, { instancePath: instancePath + "/batch", parentData: data, parentDataProperty: "batch", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate86.errors : vErrors.concat(validate86.errors);
                            errors = vErrors.length;
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.simple !== undefined) {
                            const _errs5 = errors;
                            if (!(validate92(data.simple, { instancePath: instancePath + "/simple", parentData: data, parentDataProperty: "simple", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate92.errors : vErrors.concat(validate92.errors);
                                errors = vErrors.length;
                            }
                            var valid1 = _errs5 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                    }
                }
            }
        }
    }
    else {
        validate85.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate85.errors = vErrors; return errors === 0; }
validate85.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema115 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "always_off": { "$ref": "#/$defs/AlwaysOffSampler", "description": "Configure sampler to be always_off.\nIf omitted, ignore.\n" }, "always_on": { "$ref": "#/$defs/AlwaysOnSampler", "description": "Configure sampler to be always_on.\nIf omitted, ignore.\n" }, "composite/development": { "$ref": "#/$defs/ExperimentalComposableSampler", "description": "Configure sampler to be composite.\nIf omitted, ignore.\n" }, "jaeger_remote/development": { "$ref": "#/$defs/ExperimentalJaegerRemoteSampler", "description": "Configure sampler to be jaeger_remote.\nIf omitted, ignore.\n" }, "parent_based": { "$ref": "#/$defs/ParentBasedSampler", "description": "Configure sampler to be parent_based.\nIf omitted, ignore.\n" }, "probability/development": { "$ref": "#/$defs/ExperimentalProbabilitySampler", "description": "Configure sampler to be probability.\nIf omitted, ignore.\n" }, "trace_id_ratio_based": { "$ref": "#/$defs/TraceIdRatioBasedSampler", "description": "Configure sampler to be trace_id_ratio_based.\nIf omitted, ignore.\n" } } };
const schema116 = { "type": ["object", "null"], "additionalProperties": false };
const schema117 = { "type": ["object", "null"], "additionalProperties": false };
const schema131 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "ratio": { "type": ["number", "null"], "minimum": 0, "maximum": 1, "description": "Configure ratio.\nIf omitted or null, 1.0 is used.\n" } } };
const schema132 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "ratio": { "type": ["number", "null"], "minimum": 0, "maximum": 1, "description": "Configure trace_id_ratio.\nIf omitted or null, 1.0 is used.\n" } } };
const schema118 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "always_off": { "$ref": "#/$defs/ExperimentalComposableAlwaysOffSampler", "description": "Configure sampler to be always_off.\nIf omitted, ignore.\n" }, "always_on": { "$ref": "#/$defs/ExperimentalComposableAlwaysOnSampler", "description": "Configure sampler to be always_on.\nIf omitted, ignore.\n" }, "parent_threshold": { "$ref": "#/$defs/ExperimentalComposableParentThresholdSampler", "description": "Configure sampler to be parent_threshold.\nIf omitted, ignore.\n" }, "probability": { "$ref": "#/$defs/ExperimentalComposableProbabilitySampler", "description": "Configure sampler to be probability.\nIf omitted, ignore.\n" }, "rule_based": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSampler", "description": "Configure sampler to be rule_based.\nIf omitted, ignore.\n" } } };
const schema119 = { "type": ["object", "null"], "additionalProperties": false };
const schema120 = { "type": ["object", "null"], "additionalProperties": false };
const schema122 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "ratio": { "type": ["number", "null"], "minimum": 0, "maximum": 1, "description": "Configure ratio.\nIf omitted or null, 1.0 is used.\n" } } };
const schema121 = { "type": ["object"], "additionalProperties": false, "properties": { "root": { "$ref": "#/$defs/ExperimentalComposableSampler", "description": "Sampler to use when there is no parent.\nProperty is required and must be non-null.\n" } }, "required": ["root"] };
const wrapper0 = { validate: validate97 };
function validate98(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate98.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.root === undefined) && (missing0 = "root")) {
            validate98.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(key0 === "root")) {
                    validate98.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.root !== undefined) {
                    if (!(wrapper0.validate(data.root, { instancePath: instancePath + "/root", parentData: data, parentDataProperty: "root", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? wrapper0.validate.errors : vErrors.concat(wrapper0.validate.errors);
                        errors = vErrors.length;
                    }
                }
            }
        }
    }
    else {
        validate98.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema121.type }, message: "must be object" }];
        return false;
    }
} validate98.errors = vErrors; return errors === 0; }
validate98.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema123 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "rules": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSamplerRule" }, "description": "The rules for the sampler, matched in order.\nEach rule can have multiple match conditions. All conditions must match for the rule to match.\nIf no conditions are specified, the rule matches all spans that reach it.\nIf no rules match, the span is not sampled.\nIf omitted, no span is sampled.\n" } } };
const schema124 = { "type": "object", "description": "A rule for ExperimentalComposableRuleBasedSampler. A rule can have multiple match conditions - the sampler will be applied if all match. \nIf no conditions are specified, the rule matches all spans that reach it.\n", "additionalProperties": false, "properties": { "attribute_values": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues", "description": "Values to match against a single attribute. Non-string attributes are matched using their string representation:\nfor example, a value of \"404\" would match the http.response.status_code 404. For array attributes, if any\nitem matches, it is considered a match.\nIf omitted, ignore.\n" }, "attribute_patterns": { "$ref": "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns", "description": "Patterns to match against a single attribute. Non-string attributes are matched using their string representation:\nfor example, a pattern of \"4*\" would match any http.response.status_code in 400-499. For array attributes, if any\nitem matches, it is considered a match.\nIf omitted, ignore.\n" }, "span_kinds": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/SpanKind" }, "description": "The span kinds to match. If the span's kind matches any of these, it matches.\nValues include:\n* client: client, a client span.\n* consumer: consumer, a consumer span.\n* internal: internal, an internal span.\n* producer: producer, a producer span.\n* server: server, a server span.\nIf omitted, ignore.\n" }, "parent": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalSpanParent" }, "description": "The parent span types to match.\nValues include:\n* local: local, a local parent.\n* none: none, no parent, i.e., the trace root.\n* remote: remote, a remote parent.\nIf omitted, ignore.\n" }, "sampler": { "$ref": "#/$defs/ExperimentalComposableSampler", "description": "The sampler to use for matching spans.\nProperty is required and must be non-null.\n" } }, "required": ["sampler"] };
const schema125 = { "type": "object", "additionalProperties": false, "properties": { "key": { "type": "string", "description": "The attribute key to match against.\nProperty is required and must be non-null.\n" }, "values": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "The attribute values to match against. If the attribute's value matches any of these, it matches.\nProperty is required and must be non-null.\n" } }, "required": ["key", "values"] };
const schema126 = { "type": "object", "additionalProperties": false, "properties": { "key": { "type": "string", "description": "The attribute key to match against.\nProperty is required and must be non-null.\n" }, "included": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to include.\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, all values are included.\n" }, "excluded": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure list of value patterns to exclude. Applies after .included (i.e. excluded has higher priority than included).\nMatching is case-sensitive. Values are evaluated to match as follows:\n * If the value exactly matches.\n * If the value matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nIf omitted, .included attributes are included.\n" } }, "required": ["key"] };
const schema127 = { "type": ["string", "null"], "enum": ["internal", "server", "client", "producer", "consumer"] };
const schema128 = { "type": ["string", "null"], "enum": ["none", "remote", "local"] };
function validate101(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate101.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.sampler === undefined) && (missing0 = "sampler")) {
            validate101.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((((key0 === "attribute_values") || (key0 === "attribute_patterns")) || (key0 === "span_kinds")) || (key0 === "parent")) || (key0 === "sampler"))) {
                    validate101.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.attribute_values !== undefined) {
                    let data0 = data.attribute_values;
                    const _errs2 = errors;
                    const _errs3 = errors;
                    if (errors === _errs3) {
                        if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                            let missing1;
                            if (((data0.key === undefined) && (missing1 = "key")) || ((data0.values === undefined) && (missing1 = "values"))) {
                                validate101.errors = [{ instancePath: instancePath + "/attribute_values", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" }];
                                return false;
                            }
                            else {
                                const _errs5 = errors;
                                for (const key1 in data0) {
                                    if (!((key1 === "key") || (key1 === "values"))) {
                                        validate101.errors = [{ instancePath: instancePath + "/attribute_values", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                                if (_errs5 === errors) {
                                    if (data0.key !== undefined) {
                                        const _errs6 = errors;
                                        if (typeof data0.key !== "string") {
                                            validate101.errors = [{ instancePath: instancePath + "/attribute_values/key", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                            return false;
                                        }
                                        var valid2 = _errs6 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                    if (valid2) {
                                        if (data0.values !== undefined) {
                                            let data2 = data0.values;
                                            const _errs8 = errors;
                                            if (errors === _errs8) {
                                                if (Array.isArray(data2)) {
                                                    if (data2.length < 1) {
                                                        validate101.errors = [{ instancePath: instancePath + "/attribute_values/values", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues/properties/values/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                        return false;
                                                    }
                                                    else {
                                                        var valid3 = true;
                                                        const len0 = data2.length;
                                                        for (let i0 = 0; i0 < len0; i0++) {
                                                            const _errs10 = errors;
                                                            if (typeof data2[i0] !== "string") {
                                                                validate101.errors = [{ instancePath: instancePath + "/attribute_values/values/" + i0, schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues/properties/values/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                return false;
                                                            }
                                                            var valid3 = _errs10 === errors;
                                                            if (!valid3) {
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                                else {
                                                    validate101.errors = [{ instancePath: instancePath + "/attribute_values/values", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues/properties/values/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                    return false;
                                                }
                                            }
                                            var valid2 = _errs8 === errors;
                                        }
                                        else {
                                            var valid2 = true;
                                        }
                                    }
                                }
                            }
                        }
                        else {
                            validate101.errors = [{ instancePath: instancePath + "/attribute_values", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributeValues/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                            return false;
                        }
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.attribute_patterns !== undefined) {
                        let data4 = data.attribute_patterns;
                        const _errs12 = errors;
                        const _errs13 = errors;
                        if (errors === _errs13) {
                            if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                                let missing2;
                                if ((data4.key === undefined) && (missing2 = "key")) {
                                    validate101.errors = [{ instancePath: instancePath + "/attribute_patterns", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/required", keyword: "required", params: { missingProperty: missing2 }, message: "must have required property '" + missing2 + "'" }];
                                    return false;
                                }
                                else {
                                    const _errs15 = errors;
                                    for (const key2 in data4) {
                                        if (!(((key2 === "key") || (key2 === "included")) || (key2 === "excluded"))) {
                                            validate101.errors = [{ instancePath: instancePath + "/attribute_patterns", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                            return false;
                                            break;
                                        }
                                    }
                                    if (_errs15 === errors) {
                                        if (data4.key !== undefined) {
                                            const _errs16 = errors;
                                            if (typeof data4.key !== "string") {
                                                validate101.errors = [{ instancePath: instancePath + "/attribute_patterns/key", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                return false;
                                            }
                                            var valid5 = _errs16 === errors;
                                        }
                                        else {
                                            var valid5 = true;
                                        }
                                        if (valid5) {
                                            if (data4.included !== undefined) {
                                                let data6 = data4.included;
                                                const _errs18 = errors;
                                                if (errors === _errs18) {
                                                    if (Array.isArray(data6)) {
                                                        if (data6.length < 1) {
                                                            validate101.errors = [{ instancePath: instancePath + "/attribute_patterns/included", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/properties/included/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                            return false;
                                                        }
                                                        else {
                                                            var valid6 = true;
                                                            const len1 = data6.length;
                                                            for (let i1 = 0; i1 < len1; i1++) {
                                                                const _errs20 = errors;
                                                                if (typeof data6[i1] !== "string") {
                                                                    validate101.errors = [{ instancePath: instancePath + "/attribute_patterns/included/" + i1, schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/properties/included/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                    return false;
                                                                }
                                                                var valid6 = _errs20 === errors;
                                                                if (!valid6) {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        validate101.errors = [{ instancePath: instancePath + "/attribute_patterns/included", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/properties/included/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                        return false;
                                                    }
                                                }
                                                var valid5 = _errs18 === errors;
                                            }
                                            else {
                                                var valid5 = true;
                                            }
                                            if (valid5) {
                                                if (data4.excluded !== undefined) {
                                                    let data8 = data4.excluded;
                                                    const _errs22 = errors;
                                                    if (errors === _errs22) {
                                                        if (Array.isArray(data8)) {
                                                            if (data8.length < 1) {
                                                                validate101.errors = [{ instancePath: instancePath + "/attribute_patterns/excluded", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/properties/excluded/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                                return false;
                                                            }
                                                            else {
                                                                var valid7 = true;
                                                                const len2 = data8.length;
                                                                for (let i2 = 0; i2 < len2; i2++) {
                                                                    const _errs24 = errors;
                                                                    if (typeof data8[i2] !== "string") {
                                                                        validate101.errors = [{ instancePath: instancePath + "/attribute_patterns/excluded/" + i2, schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/properties/excluded/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                        return false;
                                                                    }
                                                                    var valid7 = _errs24 === errors;
                                                                    if (!valid7) {
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        else {
                                                            validate101.errors = [{ instancePath: instancePath + "/attribute_patterns/excluded", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/properties/excluded/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                            return false;
                                                        }
                                                    }
                                                    var valid5 = _errs22 === errors;
                                                }
                                                else {
                                                    var valid5 = true;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else {
                                validate101.errors = [{ instancePath: instancePath + "/attribute_patterns", schemaPath: "#/$defs/ExperimentalComposableRuleBasedSamplerRuleAttributePatterns/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                return false;
                            }
                        }
                        var valid0 = _errs12 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.span_kinds !== undefined) {
                            let data10 = data.span_kinds;
                            const _errs26 = errors;
                            if (errors === _errs26) {
                                if (Array.isArray(data10)) {
                                    if (data10.length < 1) {
                                        validate101.errors = [{ instancePath: instancePath + "/span_kinds", schemaPath: "#/properties/span_kinds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                        return false;
                                    }
                                    else {
                                        var valid8 = true;
                                        const len3 = data10.length;
                                        for (let i3 = 0; i3 < len3; i3++) {
                                            let data11 = data10[i3];
                                            const _errs28 = errors;
                                            if ((typeof data11 !== "string") && (data11 !== null)) {
                                                validate101.errors = [{ instancePath: instancePath + "/span_kinds/" + i3, schemaPath: "#/$defs/SpanKind/type", keyword: "type", params: { type: schema127.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            if (!(((((data11 === "internal") || (data11 === "server")) || (data11 === "client")) || (data11 === "producer")) || (data11 === "consumer"))) {
                                                validate101.errors = [{ instancePath: instancePath + "/span_kinds/" + i3, schemaPath: "#/$defs/SpanKind/enum", keyword: "enum", params: { allowedValues: schema127.enum }, message: "must be equal to one of the allowed values" }];
                                                return false;
                                            }
                                            var valid8 = _errs28 === errors;
                                            if (!valid8) {
                                                break;
                                            }
                                        }
                                    }
                                }
                                else {
                                    validate101.errors = [{ instancePath: instancePath + "/span_kinds", schemaPath: "#/properties/span_kinds/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                    return false;
                                }
                            }
                            var valid0 = _errs26 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.parent !== undefined) {
                                let data12 = data.parent;
                                const _errs31 = errors;
                                if (errors === _errs31) {
                                    if (Array.isArray(data12)) {
                                        if (data12.length < 1) {
                                            validate101.errors = [{ instancePath: instancePath + "/parent", schemaPath: "#/properties/parent/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                            return false;
                                        }
                                        else {
                                            var valid10 = true;
                                            const len4 = data12.length;
                                            for (let i4 = 0; i4 < len4; i4++) {
                                                let data13 = data12[i4];
                                                const _errs33 = errors;
                                                if ((typeof data13 !== "string") && (data13 !== null)) {
                                                    validate101.errors = [{ instancePath: instancePath + "/parent/" + i4, schemaPath: "#/$defs/ExperimentalSpanParent/type", keyword: "type", params: { type: schema128.type }, message: "must be string,null" }];
                                                    return false;
                                                }
                                                if (!(((data13 === "none") || (data13 === "remote")) || (data13 === "local"))) {
                                                    validate101.errors = [{ instancePath: instancePath + "/parent/" + i4, schemaPath: "#/$defs/ExperimentalSpanParent/enum", keyword: "enum", params: { allowedValues: schema128.enum }, message: "must be equal to one of the allowed values" }];
                                                    return false;
                                                }
                                                var valid10 = _errs33 === errors;
                                                if (!valid10) {
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    else {
                                        validate101.errors = [{ instancePath: instancePath + "/parent", schemaPath: "#/properties/parent/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                        return false;
                                    }
                                }
                                var valid0 = _errs31 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.sampler !== undefined) {
                                    const _errs36 = errors;
                                    if (!(wrapper0.validate(data.sampler, { instancePath: instancePath + "/sampler", parentData: data, parentDataProperty: "sampler", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? wrapper0.validate.errors : vErrors.concat(wrapper0.validate.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid0 = _errs36 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate101.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate101.errors = vErrors; return errors === 0; }
validate101.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate100(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate100.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate100.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema123.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(key0 === "rules")) {
                validate100.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.rules !== undefined) {
                let data0 = data.rules;
                const _errs2 = errors;
                if (errors === _errs2) {
                    if (Array.isArray(data0)) {
                        if (data0.length < 1) {
                            validate100.errors = [{ instancePath: instancePath + "/rules", schemaPath: "#/properties/rules/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                            return false;
                        }
                        else {
                            var valid1 = true;
                            const len0 = data0.length;
                            for (let i0 = 0; i0 < len0; i0++) {
                                const _errs4 = errors;
                                if (!(validate101(data0[i0], { instancePath: instancePath + "/rules/" + i0, parentData: data0, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate101.errors : vErrors.concat(validate101.errors);
                                    errors = vErrors.length;
                                }
                                var valid1 = _errs4 === errors;
                                if (!valid1) {
                                    break;
                                }
                            }
                        }
                    }
                    else {
                        validate100.errors = [{ instancePath: instancePath + "/rules", schemaPath: "#/properties/rules/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                        return false;
                    }
                }
            }
        }
    }
} validate100.errors = vErrors; return errors === 0; }
validate100.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate97(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate97.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate97.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate97.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!(((((key0 === "always_off") || (key0 === "always_on")) || (key0 === "parent_threshold")) || (key0 === "probability")) || (key0 === "rule_based"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate97.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema118.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.always_off !== undefined) {
                        let data1 = data.always_off;
                        const _errs4 = errors;
                        const _errs5 = errors;
                        if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                            validate97.errors = [{ instancePath: instancePath + "/always_off", schemaPath: "#/$defs/ExperimentalComposableAlwaysOffSampler/type", keyword: "type", params: { type: schema119.type }, message: "must be object,null" }];
                            return false;
                        }
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                for (const key1 in data1) {
                                    validate97.errors = [{ instancePath: instancePath + "/always_off", schemaPath: "#/$defs/ExperimentalComposableAlwaysOffSampler/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.always_on !== undefined) {
                            let data2 = data.always_on;
                            const _errs8 = errors;
                            const _errs9 = errors;
                            if ((!(data2 && typeof data2 == "object" && !Array.isArray(data2))) && (data2 !== null)) {
                                validate97.errors = [{ instancePath: instancePath + "/always_on", schemaPath: "#/$defs/ExperimentalComposableAlwaysOnSampler/type", keyword: "type", params: { type: schema120.type }, message: "must be object,null" }];
                                return false;
                            }
                            if (errors === _errs9) {
                                if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                                    for (const key2 in data2) {
                                        validate97.errors = [{ instancePath: instancePath + "/always_on", schemaPath: "#/$defs/ExperimentalComposableAlwaysOnSampler/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                            }
                            var valid1 = _errs8 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data.parent_threshold !== undefined) {
                                const _errs12 = errors;
                                if (!(validate98(data.parent_threshold, { instancePath: instancePath + "/parent_threshold", parentData: data, parentDataProperty: "parent_threshold", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate98.errors : vErrors.concat(validate98.errors);
                                    errors = vErrors.length;
                                }
                                var valid1 = _errs12 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                            if (valid1) {
                                if (data.probability !== undefined) {
                                    let data4 = data.probability;
                                    const _errs13 = errors;
                                    const _errs14 = errors;
                                    if ((!(data4 && typeof data4 == "object" && !Array.isArray(data4))) && (data4 !== null)) {
                                        validate97.errors = [{ instancePath: instancePath + "/probability", schemaPath: "#/$defs/ExperimentalComposableProbabilitySampler/type", keyword: "type", params: { type: schema122.type }, message: "must be object,null" }];
                                        return false;
                                    }
                                    if (errors === _errs14) {
                                        if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                                            const _errs16 = errors;
                                            for (const key3 in data4) {
                                                if (!(key3 === "ratio")) {
                                                    validate97.errors = [{ instancePath: instancePath + "/probability", schemaPath: "#/$defs/ExperimentalComposableProbabilitySampler/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                                                    return false;
                                                    break;
                                                }
                                            }
                                            if (_errs16 === errors) {
                                                if (data4.ratio !== undefined) {
                                                    let data5 = data4.ratio;
                                                    const _errs17 = errors;
                                                    if ((!(typeof data5 == "number")) && (data5 !== null)) {
                                                        validate97.errors = [{ instancePath: instancePath + "/probability/ratio", schemaPath: "#/$defs/ExperimentalComposableProbabilitySampler/properties/ratio/type", keyword: "type", params: { type: schema122.properties.ratio.type }, message: "must be number,null" }];
                                                        return false;
                                                    }
                                                    if (errors === _errs17) {
                                                        if (typeof data5 == "number") {
                                                            if (data5 > 1 || isNaN(data5)) {
                                                                validate97.errors = [{ instancePath: instancePath + "/probability/ratio", schemaPath: "#/$defs/ExperimentalComposableProbabilitySampler/properties/ratio/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1 }, message: "must be <= 1" }];
                                                                return false;
                                                            }
                                                            else {
                                                                if (data5 < 0 || isNaN(data5)) {
                                                                    validate97.errors = [{ instancePath: instancePath + "/probability/ratio", schemaPath: "#/$defs/ExperimentalComposableProbabilitySampler/properties/ratio/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                                    return false;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    var valid1 = _errs13 === errors;
                                }
                                else {
                                    var valid1 = true;
                                }
                                if (valid1) {
                                    if (data.rule_based !== undefined) {
                                        const _errs19 = errors;
                                        if (!(validate100(data.rule_based, { instancePath: instancePath + "/rule_based", parentData: data, parentDataProperty: "rule_based", rootData, dynamicAnchors }))) {
                                            vErrors = vErrors === null ? validate100.errors : vErrors.concat(validate100.errors);
                                            errors = vErrors.length;
                                        }
                                        var valid1 = _errs19 === errors;
                                    }
                                    else {
                                        var valid1 = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate97.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate97.errors = vErrors; return errors === 0; }
validate97.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema129 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "endpoint": { "type": ["string"], "description": "Configure the endpoint of the jaeger remote sampling service.\nProperty is required and must be non-null.\n" }, "interval": { "type": ["integer", "null"], "minimum": 0, "description": "Configure the polling interval (in milliseconds) to fetch from the remote sampling service.\nIf omitted or null, 60000 is used.\n" }, "initial_sampler": { "$ref": "#/$defs/Sampler", "description": "Configure the initial sampler used before first configuration is fetched.\nProperty is required and must be non-null.\n" } }, "required": ["endpoint", "initial_sampler"] };
const wrapper2 = { validate: validate96 };
function validate105(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate105.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate105.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema129.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if (((data.endpoint === undefined) && (missing0 = "endpoint")) || ((data.initial_sampler === undefined) && (missing0 = "initial_sampler"))) {
            validate105.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((key0 === "endpoint") || (key0 === "interval")) || (key0 === "initial_sampler"))) {
                    validate105.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.endpoint !== undefined) {
                    const _errs2 = errors;
                    if (typeof data.endpoint !== "string") {
                        validate105.errors = [{ instancePath: instancePath + "/endpoint", schemaPath: "#/properties/endpoint/type", keyword: "type", params: { type: schema129.properties.endpoint.type }, message: "must be string" }];
                        return false;
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.interval !== undefined) {
                        let data1 = data.interval;
                        const _errs4 = errors;
                        if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                            validate105.errors = [{ instancePath: instancePath + "/interval", schemaPath: "#/properties/interval/type", keyword: "type", params: { type: schema129.properties.interval.type }, message: "must be integer,null" }];
                            return false;
                        }
                        if (errors === _errs4) {
                            if (typeof data1 == "number") {
                                if (data1 < 0 || isNaN(data1)) {
                                    validate105.errors = [{ instancePath: instancePath + "/interval", schemaPath: "#/properties/interval/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                    return false;
                                }
                            }
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.initial_sampler !== undefined) {
                            const _errs6 = errors;
                            if (!(wrapper2.validate(data.initial_sampler, { instancePath: instancePath + "/initial_sampler", parentData: data, parentDataProperty: "initial_sampler", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                                errors = vErrors.length;
                            }
                            var valid0 = _errs6 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                    }
                }
            }
        }
    }
} validate105.errors = vErrors; return errors === 0; }
validate105.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema130 = { "type": ["object", "null"], "additionalProperties": false, "properties": { "root": { "$ref": "#/$defs/Sampler", "description": "Configure root sampler.\nIf omitted, always_on is used.\n" }, "remote_parent_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure remote_parent_sampled sampler.\nIf omitted, always_on is used.\n" }, "remote_parent_not_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure remote_parent_not_sampled sampler.\nIf omitted, always_off is used.\n" }, "local_parent_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure local_parent_sampled sampler.\nIf omitted, always_on is used.\n" }, "local_parent_not_sampled": { "$ref": "#/$defs/Sampler", "description": "Configure local_parent_not_sampled sampler.\nIf omitted, always_off is used.\n" } } };
function validate107(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate107.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if ((!(data && typeof data == "object" && !Array.isArray(data))) && (data !== null)) {
    validate107.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema130.type }, message: "must be object,null" }];
    return false;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(((((key0 === "root") || (key0 === "remote_parent_sampled")) || (key0 === "remote_parent_not_sampled")) || (key0 === "local_parent_sampled")) || (key0 === "local_parent_not_sampled"))) {
                validate107.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.root !== undefined) {
                const _errs2 = errors;
                if (!(wrapper2.validate(data.root, { instancePath: instancePath + "/root", parentData: data, parentDataProperty: "root", rootData, dynamicAnchors }))) {
                    vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                    errors = vErrors.length;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.remote_parent_sampled !== undefined) {
                    const _errs3 = errors;
                    if (!(wrapper2.validate(data.remote_parent_sampled, { instancePath: instancePath + "/remote_parent_sampled", parentData: data, parentDataProperty: "remote_parent_sampled", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                        errors = vErrors.length;
                    }
                    var valid0 = _errs3 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.remote_parent_not_sampled !== undefined) {
                        const _errs4 = errors;
                        if (!(wrapper2.validate(data.remote_parent_not_sampled, { instancePath: instancePath + "/remote_parent_not_sampled", parentData: data, parentDataProperty: "remote_parent_not_sampled", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                            errors = vErrors.length;
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.local_parent_sampled !== undefined) {
                            const _errs5 = errors;
                            if (!(wrapper2.validate(data.local_parent_sampled, { instancePath: instancePath + "/local_parent_sampled", parentData: data, parentDataProperty: "local_parent_sampled", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                                errors = vErrors.length;
                            }
                            var valid0 = _errs5 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.local_parent_not_sampled !== undefined) {
                                const _errs6 = errors;
                                if (!(wrapper2.validate(data.local_parent_not_sampled, { instancePath: instancePath + "/local_parent_not_sampled", parentData: data, parentDataProperty: "local_parent_not_sampled", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                                    errors = vErrors.length;
                                }
                                var valid0 = _errs6 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                        }
                    }
                }
            }
        }
    }
} validate107.errors = vErrors; return errors === 0; }
validate107.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate96(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate96.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate96.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate96.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!(((((((key0 === "always_off") || (key0 === "always_on")) || (key0 === "composite/development")) || (key0 === "jaeger_remote/development")) || (key0 === "parent_based")) || (key0 === "probability/development")) || (key0 === "trace_id_ratio_based"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate96.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema115.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.always_off !== undefined) {
                        let data1 = data.always_off;
                        const _errs4 = errors;
                        const _errs5 = errors;
                        if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                            validate96.errors = [{ instancePath: instancePath + "/always_off", schemaPath: "#/$defs/AlwaysOffSampler/type", keyword: "type", params: { type: schema116.type }, message: "must be object,null" }];
                            return false;
                        }
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                for (const key1 in data1) {
                                    validate96.errors = [{ instancePath: instancePath + "/always_off", schemaPath: "#/$defs/AlwaysOffSampler/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.always_on !== undefined) {
                            let data2 = data.always_on;
                            const _errs8 = errors;
                            const _errs9 = errors;
                            if ((!(data2 && typeof data2 == "object" && !Array.isArray(data2))) && (data2 !== null)) {
                                validate96.errors = [{ instancePath: instancePath + "/always_on", schemaPath: "#/$defs/AlwaysOnSampler/type", keyword: "type", params: { type: schema117.type }, message: "must be object,null" }];
                                return false;
                            }
                            if (errors === _errs9) {
                                if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                                    for (const key2 in data2) {
                                        validate96.errors = [{ instancePath: instancePath + "/always_on", schemaPath: "#/$defs/AlwaysOnSampler/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                            }
                            var valid1 = _errs8 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data["composite/development"] !== undefined) {
                                const _errs12 = errors;
                                if (!(validate97(data["composite/development"], { instancePath: instancePath + "/composite~1development", parentData: data, parentDataProperty: "composite/development", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate97.errors : vErrors.concat(validate97.errors);
                                    errors = vErrors.length;
                                }
                                var valid1 = _errs12 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                            if (valid1) {
                                if (data["jaeger_remote/development"] !== undefined) {
                                    const _errs13 = errors;
                                    if (!(validate105(data["jaeger_remote/development"], { instancePath: instancePath + "/jaeger_remote~1development", parentData: data, parentDataProperty: "jaeger_remote/development", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate105.errors : vErrors.concat(validate105.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid1 = _errs13 === errors;
                                }
                                else {
                                    var valid1 = true;
                                }
                                if (valid1) {
                                    if (data.parent_based !== undefined) {
                                        const _errs14 = errors;
                                        if (!(validate107(data.parent_based, { instancePath: instancePath + "/parent_based", parentData: data, parentDataProperty: "parent_based", rootData, dynamicAnchors }))) {
                                            vErrors = vErrors === null ? validate107.errors : vErrors.concat(validate107.errors);
                                            errors = vErrors.length;
                                        }
                                        var valid1 = _errs14 === errors;
                                    }
                                    else {
                                        var valid1 = true;
                                    }
                                    if (valid1) {
                                        if (data["probability/development"] !== undefined) {
                                            let data6 = data["probability/development"];
                                            const _errs15 = errors;
                                            const _errs16 = errors;
                                            if ((!(data6 && typeof data6 == "object" && !Array.isArray(data6))) && (data6 !== null)) {
                                                validate96.errors = [{ instancePath: instancePath + "/probability~1development", schemaPath: "#/$defs/ExperimentalProbabilitySampler/type", keyword: "type", params: { type: schema131.type }, message: "must be object,null" }];
                                                return false;
                                            }
                                            if (errors === _errs16) {
                                                if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
                                                    const _errs18 = errors;
                                                    for (const key3 in data6) {
                                                        if (!(key3 === "ratio")) {
                                                            validate96.errors = [{ instancePath: instancePath + "/probability~1development", schemaPath: "#/$defs/ExperimentalProbabilitySampler/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                                                            return false;
                                                            break;
                                                        }
                                                    }
                                                    if (_errs18 === errors) {
                                                        if (data6.ratio !== undefined) {
                                                            let data7 = data6.ratio;
                                                            const _errs19 = errors;
                                                            if ((!(typeof data7 == "number")) && (data7 !== null)) {
                                                                validate96.errors = [{ instancePath: instancePath + "/probability~1development/ratio", schemaPath: "#/$defs/ExperimentalProbabilitySampler/properties/ratio/type", keyword: "type", params: { type: schema131.properties.ratio.type }, message: "must be number,null" }];
                                                                return false;
                                                            }
                                                            if (errors === _errs19) {
                                                                if (typeof data7 == "number") {
                                                                    if (data7 > 1 || isNaN(data7)) {
                                                                        validate96.errors = [{ instancePath: instancePath + "/probability~1development/ratio", schemaPath: "#/$defs/ExperimentalProbabilitySampler/properties/ratio/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1 }, message: "must be <= 1" }];
                                                                        return false;
                                                                    }
                                                                    else {
                                                                        if (data7 < 0 || isNaN(data7)) {
                                                                            validate96.errors = [{ instancePath: instancePath + "/probability~1development/ratio", schemaPath: "#/$defs/ExperimentalProbabilitySampler/properties/ratio/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                                            return false;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            var valid1 = _errs15 === errors;
                                        }
                                        else {
                                            var valid1 = true;
                                        }
                                        if (valid1) {
                                            if (data.trace_id_ratio_based !== undefined) {
                                                let data8 = data.trace_id_ratio_based;
                                                const _errs21 = errors;
                                                const _errs22 = errors;
                                                if ((!(data8 && typeof data8 == "object" && !Array.isArray(data8))) && (data8 !== null)) {
                                                    validate96.errors = [{ instancePath: instancePath + "/trace_id_ratio_based", schemaPath: "#/$defs/TraceIdRatioBasedSampler/type", keyword: "type", params: { type: schema132.type }, message: "must be object,null" }];
                                                    return false;
                                                }
                                                if (errors === _errs22) {
                                                    if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
                                                        const _errs24 = errors;
                                                        for (const key4 in data8) {
                                                            if (!(key4 === "ratio")) {
                                                                validate96.errors = [{ instancePath: instancePath + "/trace_id_ratio_based", schemaPath: "#/$defs/TraceIdRatioBasedSampler/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" }];
                                                                return false;
                                                                break;
                                                            }
                                                        }
                                                        if (_errs24 === errors) {
                                                            if (data8.ratio !== undefined) {
                                                                let data9 = data8.ratio;
                                                                const _errs25 = errors;
                                                                if ((!(typeof data9 == "number")) && (data9 !== null)) {
                                                                    validate96.errors = [{ instancePath: instancePath + "/trace_id_ratio_based/ratio", schemaPath: "#/$defs/TraceIdRatioBasedSampler/properties/ratio/type", keyword: "type", params: { type: schema132.properties.ratio.type }, message: "must be number,null" }];
                                                                    return false;
                                                                }
                                                                if (errors === _errs25) {
                                                                    if (typeof data9 == "number") {
                                                                        if (data9 > 1 || isNaN(data9)) {
                                                                            validate96.errors = [{ instancePath: instancePath + "/trace_id_ratio_based/ratio", schemaPath: "#/$defs/TraceIdRatioBasedSampler/properties/ratio/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1 }, message: "must be <= 1" }];
                                                                            return false;
                                                                        }
                                                                        else {
                                                                            if (data9 < 0 || isNaN(data9)) {
                                                                                validate96.errors = [{ instancePath: instancePath + "/trace_id_ratio_based/ratio", schemaPath: "#/$defs/TraceIdRatioBasedSampler/properties/ratio/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                                                return false;
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                var valid1 = _errs21 === errors;
                                            }
                                            else {
                                                var valid1 = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate96.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate96.errors = vErrors; return errors === 0; }
validate96.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema133 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "random": { "$ref": "#/$defs/RandomIdGenerator", "description": "Configure the ID generator to randomly generate TraceIds and SpanIds (spec default).\nIf omitted, ignore.\n" } } };
const schema134 = { "type": ["object", "null"], "additionalProperties": false };
function validate110(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate110.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate110.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate110.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!(key0 === "random")) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate110.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema133.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.random !== undefined) {
                        let data1 = data.random;
                        const _errs5 = errors;
                        if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                            validate110.errors = [{ instancePath: instancePath + "/random", schemaPath: "#/$defs/RandomIdGenerator/type", keyword: "type", params: { type: schema134.type }, message: "must be object,null" }];
                            return false;
                        }
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                for (const key1 in data1) {
                                    validate110.errors = [{ instancePath: instancePath + "/random", schemaPath: "#/$defs/RandomIdGenerator/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate110.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate110.errors = vErrors; return errors === 0; }
validate110.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema135 = { "type": ["object"], "additionalProperties": false, "properties": { "default_config": { "$ref": "#/$defs/ExperimentalTracerConfig", "description": "Configure the default tracer config used there is no matching entry in .tracer_configurator/development.tracers.\nIf omitted, unmatched .tracers use default values as described in ExperimentalTracerConfig.\n" }, "tracers": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalTracerMatcherAndConfig" }, "description": "Configure tracers.\nIf omitted, all tracers use .default_config.\n" } } };
const schema136 = { "type": ["object"], "additionalProperties": false, "properties": { "enabled": { "type": ["boolean"], "description": "Configure if the tracer is enabled or not.\nIf omitted, true is used.\n" } } };
const schema137 = { "type": ["object"], "additionalProperties": false, "properties": { "name": { "type": ["string"], "description": "Configure tracer names to match. Matching is case-sensitive, evaluated as follows:\n\n * If the tracer name exactly matches.\n * If the tracer name matches the wildcard pattern, where '?' matches any single character and '*' matches any number of characters including none.\nProperty is required and must be non-null.\n" }, "config": { "$ref": "#/$defs/ExperimentalTracerConfig", "description": "The tracer config.\nProperty is required and must be non-null.\n" } }, "required": ["name", "config"] };
function validate113(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate113.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if (((data.name === undefined) && (missing0 = "name")) || ((data.config === undefined) && (missing0 = "config"))) {
            validate113.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!((key0 === "name") || (key0 === "config"))) {
                    validate113.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.name !== undefined) {
                    const _errs2 = errors;
                    if (typeof data.name !== "string") {
                        validate113.errors = [{ instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: schema137.properties.name.type }, message: "must be string" }];
                        return false;
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.config !== undefined) {
                        let data1 = data.config;
                        const _errs4 = errors;
                        const _errs5 = errors;
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                const _errs7 = errors;
                                for (const key1 in data1) {
                                    if (!(key1 === "enabled")) {
                                        validate113.errors = [{ instancePath: instancePath + "/config", schemaPath: "#/$defs/ExperimentalTracerConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                                if (_errs7 === errors) {
                                    if (data1.enabled !== undefined) {
                                        if (typeof data1.enabled !== "boolean") {
                                            validate113.errors = [{ instancePath: instancePath + "/config/enabled", schemaPath: "#/$defs/ExperimentalTracerConfig/properties/enabled/type", keyword: "type", params: { type: schema136.properties.enabled.type }, message: "must be boolean" }];
                                            return false;
                                        }
                                    }
                                }
                            }
                            else {
                                validate113.errors = [{ instancePath: instancePath + "/config", schemaPath: "#/$defs/ExperimentalTracerConfig/type", keyword: "type", params: { type: schema136.type }, message: "must be object" }];
                                return false;
                            }
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                }
            }
        }
    }
    else {
        validate113.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema137.type }, message: "must be object" }];
        return false;
    }
} validate113.errors = vErrors; return errors === 0; }
validate113.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate112(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate112.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((key0 === "default_config") || (key0 === "tracers"))) {
                validate112.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.default_config !== undefined) {
                let data0 = data.default_config;
                const _errs2 = errors;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(key1 === "enabled")) {
                                validate112.errors = [{ instancePath: instancePath + "/default_config", schemaPath: "#/$defs/ExperimentalTracerConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.enabled !== undefined) {
                                if (typeof data0.enabled !== "boolean") {
                                    validate112.errors = [{ instancePath: instancePath + "/default_config/enabled", schemaPath: "#/$defs/ExperimentalTracerConfig/properties/enabled/type", keyword: "type", params: { type: schema136.properties.enabled.type }, message: "must be boolean" }];
                                    return false;
                                }
                            }
                        }
                    }
                    else {
                        validate112.errors = [{ instancePath: instancePath + "/default_config", schemaPath: "#/$defs/ExperimentalTracerConfig/type", keyword: "type", params: { type: schema136.type }, message: "must be object" }];
                        return false;
                    }
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.tracers !== undefined) {
                    let data2 = data.tracers;
                    const _errs8 = errors;
                    if (errors === _errs8) {
                        if (Array.isArray(data2)) {
                            if (data2.length < 1) {
                                validate112.errors = [{ instancePath: instancePath + "/tracers", schemaPath: "#/properties/tracers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                return false;
                            }
                            else {
                                var valid3 = true;
                                const len0 = data2.length;
                                for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs10 = errors;
                                    if (!(validate113(data2[i0], { instancePath: instancePath + "/tracers/" + i0, parentData: data2, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate113.errors : vErrors.concat(validate113.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid3 = _errs10 === errors;
                                    if (!valid3) {
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            validate112.errors = [{ instancePath: instancePath + "/tracers", schemaPath: "#/properties/tracers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                        }
                    }
                    var valid0 = _errs8 === errors;
                }
                else {
                    var valid0 = true;
                }
            }
        }
    }
    else {
        validate112.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema135.type }, message: "must be object" }];
        return false;
    }
} validate112.errors = vErrors; return errors === 0; }
validate112.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate84(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate84.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.processors === undefined) && (missing0 = "processors")) {
            validate84.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((((key0 === "processors") || (key0 === "limits")) || (key0 === "sampler")) || (key0 === "id_generator")) || (key0 === "tracer_configurator/development"))) {
                    validate84.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.processors !== undefined) {
                    let data0 = data.processors;
                    const _errs2 = errors;
                    if (errors === _errs2) {
                        if (Array.isArray(data0)) {
                            if (data0.length < 1) {
                                validate84.errors = [{ instancePath: instancePath + "/processors", schemaPath: "#/properties/processors/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                return false;
                            }
                            else {
                                var valid1 = true;
                                const len0 = data0.length;
                                for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs4 = errors;
                                    if (!(validate85(data0[i0], { instancePath: instancePath + "/processors/" + i0, parentData: data0, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate85.errors : vErrors.concat(validate85.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid1 = _errs4 === errors;
                                    if (!valid1) {
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            validate84.errors = [{ instancePath: instancePath + "/processors", schemaPath: "#/properties/processors/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                        }
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.limits !== undefined) {
                        let data2 = data.limits;
                        const _errs5 = errors;
                        const _errs6 = errors;
                        if (errors === _errs6) {
                            if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                                const _errs8 = errors;
                                for (const key1 in data2) {
                                    if (!((((((key1 === "attribute_value_length_limit") || (key1 === "attribute_count_limit")) || (key1 === "event_count_limit")) || (key1 === "link_count_limit")) || (key1 === "event_attribute_count_limit")) || (key1 === "link_attribute_count_limit"))) {
                                        validate84.errors = [{ instancePath: instancePath + "/limits", schemaPath: "#/$defs/SpanLimits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                                if (_errs8 === errors) {
                                    if (data2.attribute_value_length_limit !== undefined) {
                                        let data3 = data2.attribute_value_length_limit;
                                        const _errs9 = errors;
                                        if ((!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))) && (data3 !== null)) {
                                            validate84.errors = [{ instancePath: instancePath + "/limits/attribute_value_length_limit", schemaPath: "#/$defs/SpanLimits/properties/attribute_value_length_limit/type", keyword: "type", params: { type: schema114.properties.attribute_value_length_limit.type }, message: "must be integer,null" }];
                                            return false;
                                        }
                                        if (errors === _errs9) {
                                            if (typeof data3 == "number") {
                                                if (data3 < 0 || isNaN(data3)) {
                                                    validate84.errors = [{ instancePath: instancePath + "/limits/attribute_value_length_limit", schemaPath: "#/$defs/SpanLimits/properties/attribute_value_length_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                    return false;
                                                }
                                            }
                                        }
                                        var valid3 = _errs9 === errors;
                                    }
                                    else {
                                        var valid3 = true;
                                    }
                                    if (valid3) {
                                        if (data2.attribute_count_limit !== undefined) {
                                            let data4 = data2.attribute_count_limit;
                                            const _errs11 = errors;
                                            if ((!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))) && (data4 !== null)) {
                                                validate84.errors = [{ instancePath: instancePath + "/limits/attribute_count_limit", schemaPath: "#/$defs/SpanLimits/properties/attribute_count_limit/type", keyword: "type", params: { type: schema114.properties.attribute_count_limit.type }, message: "must be integer,null" }];
                                                return false;
                                            }
                                            if (errors === _errs11) {
                                                if (typeof data4 == "number") {
                                                    if (data4 < 0 || isNaN(data4)) {
                                                        validate84.errors = [{ instancePath: instancePath + "/limits/attribute_count_limit", schemaPath: "#/$defs/SpanLimits/properties/attribute_count_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                        return false;
                                                    }
                                                }
                                            }
                                            var valid3 = _errs11 === errors;
                                        }
                                        else {
                                            var valid3 = true;
                                        }
                                        if (valid3) {
                                            if (data2.event_count_limit !== undefined) {
                                                let data5 = data2.event_count_limit;
                                                const _errs13 = errors;
                                                if ((!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))) && (data5 !== null)) {
                                                    validate84.errors = [{ instancePath: instancePath + "/limits/event_count_limit", schemaPath: "#/$defs/SpanLimits/properties/event_count_limit/type", keyword: "type", params: { type: schema114.properties.event_count_limit.type }, message: "must be integer,null" }];
                                                    return false;
                                                }
                                                if (errors === _errs13) {
                                                    if (typeof data5 == "number") {
                                                        if (data5 < 0 || isNaN(data5)) {
                                                            validate84.errors = [{ instancePath: instancePath + "/limits/event_count_limit", schemaPath: "#/$defs/SpanLimits/properties/event_count_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                            return false;
                                                        }
                                                    }
                                                }
                                                var valid3 = _errs13 === errors;
                                            }
                                            else {
                                                var valid3 = true;
                                            }
                                            if (valid3) {
                                                if (data2.link_count_limit !== undefined) {
                                                    let data6 = data2.link_count_limit;
                                                    const _errs15 = errors;
                                                    if ((!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))) && (data6 !== null)) {
                                                        validate84.errors = [{ instancePath: instancePath + "/limits/link_count_limit", schemaPath: "#/$defs/SpanLimits/properties/link_count_limit/type", keyword: "type", params: { type: schema114.properties.link_count_limit.type }, message: "must be integer,null" }];
                                                        return false;
                                                    }
                                                    if (errors === _errs15) {
                                                        if (typeof data6 == "number") {
                                                            if (data6 < 0 || isNaN(data6)) {
                                                                validate84.errors = [{ instancePath: instancePath + "/limits/link_count_limit", schemaPath: "#/$defs/SpanLimits/properties/link_count_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                                return false;
                                                            }
                                                        }
                                                    }
                                                    var valid3 = _errs15 === errors;
                                                }
                                                else {
                                                    var valid3 = true;
                                                }
                                                if (valid3) {
                                                    if (data2.event_attribute_count_limit !== undefined) {
                                                        let data7 = data2.event_attribute_count_limit;
                                                        const _errs17 = errors;
                                                        if ((!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))) && (data7 !== null)) {
                                                            validate84.errors = [{ instancePath: instancePath + "/limits/event_attribute_count_limit", schemaPath: "#/$defs/SpanLimits/properties/event_attribute_count_limit/type", keyword: "type", params: { type: schema114.properties.event_attribute_count_limit.type }, message: "must be integer,null" }];
                                                            return false;
                                                        }
                                                        if (errors === _errs17) {
                                                            if (typeof data7 == "number") {
                                                                if (data7 < 0 || isNaN(data7)) {
                                                                    validate84.errors = [{ instancePath: instancePath + "/limits/event_attribute_count_limit", schemaPath: "#/$defs/SpanLimits/properties/event_attribute_count_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                                    return false;
                                                                }
                                                            }
                                                        }
                                                        var valid3 = _errs17 === errors;
                                                    }
                                                    else {
                                                        var valid3 = true;
                                                    }
                                                    if (valid3) {
                                                        if (data2.link_attribute_count_limit !== undefined) {
                                                            let data8 = data2.link_attribute_count_limit;
                                                            const _errs19 = errors;
                                                            if ((!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))) && (data8 !== null)) {
                                                                validate84.errors = [{ instancePath: instancePath + "/limits/link_attribute_count_limit", schemaPath: "#/$defs/SpanLimits/properties/link_attribute_count_limit/type", keyword: "type", params: { type: schema114.properties.link_attribute_count_limit.type }, message: "must be integer,null" }];
                                                                return false;
                                                            }
                                                            if (errors === _errs19) {
                                                                if (typeof data8 == "number") {
                                                                    if (data8 < 0 || isNaN(data8)) {
                                                                        validate84.errors = [{ instancePath: instancePath + "/limits/link_attribute_count_limit", schemaPath: "#/$defs/SpanLimits/properties/link_attribute_count_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                                        return false;
                                                                    }
                                                                }
                                                            }
                                                            var valid3 = _errs19 === errors;
                                                        }
                                                        else {
                                                            var valid3 = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else {
                                validate84.errors = [{ instancePath: instancePath + "/limits", schemaPath: "#/$defs/SpanLimits/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                return false;
                            }
                        }
                        var valid0 = _errs5 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.sampler !== undefined) {
                            const _errs21 = errors;
                            if (!(validate96(data.sampler, { instancePath: instancePath + "/sampler", parentData: data, parentDataProperty: "sampler", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate96.errors : vErrors.concat(validate96.errors);
                                errors = vErrors.length;
                            }
                            var valid0 = _errs21 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.id_generator !== undefined) {
                                const _errs22 = errors;
                                if (!(validate110(data.id_generator, { instancePath: instancePath + "/id_generator", parentData: data, parentDataProperty: "id_generator", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate110.errors : vErrors.concat(validate110.errors);
                                    errors = vErrors.length;
                                }
                                var valid0 = _errs22 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data["tracer_configurator/development"] !== undefined) {
                                    const _errs23 = errors;
                                    if (!(validate112(data["tracer_configurator/development"], { instancePath: instancePath + "/tracer_configurator~1development", parentData: data, parentDataProperty: "tracer_configurator/development", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate112.errors : vErrors.concat(validate112.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid0 = _errs23 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate84.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate84.errors = vErrors; return errors === 0; }
validate84.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema139 = { "type": "object", "additionalProperties": false, "properties": { "attributes": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/AttributeNameValue" }, "description": "Configure resource attributes. Entries have higher priority than entries from .resource.attributes_list.\nIf omitted, no resource attributes are added.\n" }, "detection/development": { "$ref": "#/$defs/ExperimentalResourceDetection", "description": "Configure resource detection.\nIf omitted, resource detection is disabled.\n" }, "schema_url": { "type": ["string", "null"], "description": "Configure resource schema URL.\nIf omitted or null, no schema URL is used.\n" }, "attributes_list": { "type": ["string", "null"], "description": "Configure resource attributes. Entries have lower priority than entries from .resource.attributes.\nThe value is a list of comma separated key-value pairs matching the format of OTEL_RESOURCE_ATTRIBUTES. See https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/configuration/sdk-environment-variables.md#general-sdk-configuration for details.\nIf omitted or null, no resource attributes are added.\n" } } };
const schema140 = { "type": "object", "additionalProperties": false, "properties": { "name": { "type": "string", "description": "The attribute name.\nProperty is required and must be non-null.\n" }, "value": { "oneOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }, { "type": "null" }, { "type": "array", "items": { "type": "string" }, "minItems": 1 }, { "type": "array", "items": { "type": "boolean" }, "minItems": 1 }, { "type": "array", "items": { "type": "number" }, "minItems": 1 }], "description": "The attribute value.\nThe type of value must match .type.\nProperty must be present, but if null the entry is ignored.\n" }, "type": { "$ref": "#/$defs/AttributeType", "description": "The attribute type.\nValues include:\n* bool: Boolean attribute value.\n* bool_array: Boolean array attribute value.\n* double: Double attribute value.\n* double_array: Double array attribute value.\n* int: Integer attribute value.\n* int_array: Integer array attribute value.\n* string: String attribute value.\n* string_array: String array attribute value.\nIf omitted, string is used.\n" } }, "required": ["name", "value"] };
const schema141 = { "type": ["string", "null"], "enum": ["string", "bool", "int", "double", "string_array", "bool_array", "int_array", "double_array"] };
function validate118(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate118.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if (((data.name === undefined) && (missing0 = "name")) || ((data.value === undefined) && (missing0 = "value"))) {
            validate118.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            const _errs1 = errors;
            for (const key0 in data) {
                if (!(((key0 === "name") || (key0 === "value")) || (key0 === "type"))) {
                    validate118.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                    return false;
                    break;
                }
            }
            if (_errs1 === errors) {
                if (data.name !== undefined) {
                    const _errs2 = errors;
                    if (typeof data.name !== "string") {
                        validate118.errors = [{ instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                    }
                    var valid0 = _errs2 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.value !== undefined) {
                        let data1 = data.value;
                        const _errs4 = errors;
                        const _errs5 = errors;
                        let valid1 = false;
                        let passing0 = null;
                        const _errs6 = errors;
                        if (typeof data1 !== "string") {
                            const err0 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                            if (vErrors === null) {
                                vErrors = [err0];
                            }
                            else {
                                vErrors.push(err0);
                            }
                            errors++;
                        }
                        var _valid0 = _errs6 === errors;
                        if (_valid0) {
                            valid1 = true;
                            passing0 = 0;
                        }
                        const _errs8 = errors;
                        if (!(typeof data1 == "number")) {
                            const err1 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/1/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                            if (vErrors === null) {
                                vErrors = [err1];
                            }
                            else {
                                vErrors.push(err1);
                            }
                            errors++;
                        }
                        var _valid0 = _errs8 === errors;
                        if (_valid0 && valid1) {
                            valid1 = false;
                            passing0 = [passing0, 1];
                        }
                        else {
                            if (_valid0) {
                                valid1 = true;
                                passing0 = 1;
                            }
                            const _errs10 = errors;
                            if (typeof data1 !== "boolean") {
                                const err2 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/2/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                                if (vErrors === null) {
                                    vErrors = [err2];
                                }
                                else {
                                    vErrors.push(err2);
                                }
                                errors++;
                            }
                            var _valid0 = _errs10 === errors;
                            if (_valid0 && valid1) {
                                valid1 = false;
                                passing0 = [passing0, 2];
                            }
                            else {
                                if (_valid0) {
                                    valid1 = true;
                                    passing0 = 2;
                                }
                                const _errs12 = errors;
                                if (data1 !== null) {
                                    const err3 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/3/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                    if (vErrors === null) {
                                        vErrors = [err3];
                                    }
                                    else {
                                        vErrors.push(err3);
                                    }
                                    errors++;
                                }
                                var _valid0 = _errs12 === errors;
                                if (_valid0 && valid1) {
                                    valid1 = false;
                                    passing0 = [passing0, 3];
                                }
                                else {
                                    if (_valid0) {
                                        valid1 = true;
                                        passing0 = 3;
                                    }
                                    const _errs14 = errors;
                                    if (errors === _errs14) {
                                        if (Array.isArray(data1)) {
                                            if (data1.length < 1) {
                                                const err4 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/4/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                                                if (vErrors === null) {
                                                    vErrors = [err4];
                                                }
                                                else {
                                                    vErrors.push(err4);
                                                }
                                                errors++;
                                            }
                                            else {
                                                var valid2 = true;
                                                const len0 = data1.length;
                                                for (let i0 = 0; i0 < len0; i0++) {
                                                    const _errs16 = errors;
                                                    if (typeof data1[i0] !== "string") {
                                                        const err5 = { instancePath: instancePath + "/value/" + i0, schemaPath: "#/properties/value/oneOf/4/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                        if (vErrors === null) {
                                                            vErrors = [err5];
                                                        }
                                                        else {
                                                            vErrors.push(err5);
                                                        }
                                                        errors++;
                                                    }
                                                    var valid2 = _errs16 === errors;
                                                    if (!valid2) {
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        else {
                                            const err6 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/4/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                                            if (vErrors === null) {
                                                vErrors = [err6];
                                            }
                                            else {
                                                vErrors.push(err6);
                                            }
                                            errors++;
                                        }
                                    }
                                    var _valid0 = _errs14 === errors;
                                    if (_valid0 && valid1) {
                                        valid1 = false;
                                        passing0 = [passing0, 4];
                                    }
                                    else {
                                        if (_valid0) {
                                            valid1 = true;
                                            passing0 = 4;
                                            var items0 = true;
                                        }
                                        const _errs18 = errors;
                                        if (errors === _errs18) {
                                            if (Array.isArray(data1)) {
                                                if (data1.length < 1) {
                                                    const err7 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/5/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                                                    if (vErrors === null) {
                                                        vErrors = [err7];
                                                    }
                                                    else {
                                                        vErrors.push(err7);
                                                    }
                                                    errors++;
                                                }
                                                else {
                                                    var valid3 = true;
                                                    const len1 = data1.length;
                                                    for (let i1 = 0; i1 < len1; i1++) {
                                                        const _errs20 = errors;
                                                        if (typeof data1[i1] !== "boolean") {
                                                            const err8 = { instancePath: instancePath + "/value/" + i1, schemaPath: "#/properties/value/oneOf/5/items/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                                                            if (vErrors === null) {
                                                                vErrors = [err8];
                                                            }
                                                            else {
                                                                vErrors.push(err8);
                                                            }
                                                            errors++;
                                                        }
                                                        var valid3 = _errs20 === errors;
                                                        if (!valid3) {
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                const err9 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/5/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                                                if (vErrors === null) {
                                                    vErrors = [err9];
                                                }
                                                else {
                                                    vErrors.push(err9);
                                                }
                                                errors++;
                                            }
                                        }
                                        var _valid0 = _errs18 === errors;
                                        if (_valid0 && valid1) {
                                            valid1 = false;
                                            passing0 = [passing0, 5];
                                        }
                                        else {
                                            if (_valid0) {
                                                valid1 = true;
                                                passing0 = 5;
                                                if (items0 !== true) {
                                                    items0 = true;
                                                }
                                            }
                                            const _errs22 = errors;
                                            if (errors === _errs22) {
                                                if (Array.isArray(data1)) {
                                                    if (data1.length < 1) {
                                                        const err10 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/6/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                                                        if (vErrors === null) {
                                                            vErrors = [err10];
                                                        }
                                                        else {
                                                            vErrors.push(err10);
                                                        }
                                                        errors++;
                                                    }
                                                    else {
                                                        var valid4 = true;
                                                        const len2 = data1.length;
                                                        for (let i2 = 0; i2 < len2; i2++) {
                                                            const _errs24 = errors;
                                                            if (!(typeof data1[i2] == "number")) {
                                                                const err11 = { instancePath: instancePath + "/value/" + i2, schemaPath: "#/properties/value/oneOf/6/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                                                                if (vErrors === null) {
                                                                    vErrors = [err11];
                                                                }
                                                                else {
                                                                    vErrors.push(err11);
                                                                }
                                                                errors++;
                                                            }
                                                            var valid4 = _errs24 === errors;
                                                            if (!valid4) {
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                                else {
                                                    const err12 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf/6/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                                                    if (vErrors === null) {
                                                        vErrors = [err12];
                                                    }
                                                    else {
                                                        vErrors.push(err12);
                                                    }
                                                    errors++;
                                                }
                                            }
                                            var _valid0 = _errs22 === errors;
                                            if (_valid0 && valid1) {
                                                valid1 = false;
                                                passing0 = [passing0, 6];
                                            }
                                            else {
                                                if (_valid0) {
                                                    valid1 = true;
                                                    passing0 = 6;
                                                    if (items0 !== true) {
                                                        items0 = true;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (!valid1) {
                            const err13 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
                            if (vErrors === null) {
                                vErrors = [err13];
                            }
                            else {
                                vErrors.push(err13);
                            }
                            errors++;
                            validate118.errors = vErrors;
                            return false;
                        }
                        else {
                            errors = _errs5;
                            if (vErrors !== null) {
                                if (_errs5) {
                                    vErrors.length = _errs5;
                                }
                                else {
                                    vErrors = null;
                                }
                            }
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.type !== undefined) {
                            let data5 = data.type;
                            const _errs26 = errors;
                            if ((typeof data5 !== "string") && (data5 !== null)) {
                                validate118.errors = [{ instancePath: instancePath + "/type", schemaPath: "#/$defs/AttributeType/type", keyword: "type", params: { type: schema141.type }, message: "must be string,null" }];
                                return false;
                            }
                            if (!((((((((data5 === "string") || (data5 === "bool")) || (data5 === "int")) || (data5 === "double")) || (data5 === "string_array")) || (data5 === "bool_array")) || (data5 === "int_array")) || (data5 === "double_array"))) {
                                validate118.errors = [{ instancePath: instancePath + "/type", schemaPath: "#/$defs/AttributeType/enum", keyword: "enum", params: { allowedValues: schema141.enum }, message: "must be equal to one of the allowed values" }];
                                return false;
                            }
                            var valid0 = _errs26 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                    }
                }
            }
        }
    }
    else {
        validate118.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate118.errors = vErrors; return errors === 0; }
validate118.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema142 = { "type": "object", "additionalProperties": false, "properties": { "attributes": { "$ref": "#/$defs/IncludeExclude", "description": "Configure attributes provided by resource detectors.\nIf omitted, all attributes from resource detectors are added.\n" }, "detectors": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ExperimentalResourceDetector" }, "description": "Configure resource detectors.\nResource detector names are dependent on the SDK language ecosystem. Please consult documentation for each respective language. \nIf omitted, no resource detectors are enabled.\n" } } };
const schema144 = { "type": "object", "additionalProperties": { "type": ["object", "null"] }, "minProperties": 1, "maxProperties": 1, "properties": { "container": { "$ref": "#/$defs/ExperimentalContainerResourceDetector", "description": "Enable the container resource detector, which populates container.* attributes.\nIf omitted, ignore.\n" }, "host": { "$ref": "#/$defs/ExperimentalHostResourceDetector", "description": "Enable the host resource detector, which populates host.* and os.* attributes.\nIf omitted, ignore.\n" }, "process": { "$ref": "#/$defs/ExperimentalProcessResourceDetector", "description": "Enable the process resource detector, which populates process.* attributes.\nIf omitted, ignore.\n" }, "service": { "$ref": "#/$defs/ExperimentalServiceResourceDetector", "description": "Enable the service detector, which populates service.name based on the OTEL_SERVICE_NAME environment variable and service.instance.id.\nIf omitted, ignore.\n" } } };
const schema145 = { "type": ["object", "null"], "additionalProperties": false };
const schema146 = { "type": ["object", "null"], "additionalProperties": false };
const schema147 = { "type": ["object", "null"], "additionalProperties": false };
const schema148 = { "type": ["object", "null"], "additionalProperties": false };
function validate121(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate121.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        if (Object.keys(data).length > 1) {
            validate121.errors = [{ instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 1 }, message: "must NOT have more than 1 properties" }];
            return false;
        }
        else {
            if (Object.keys(data).length < 1) {
                validate121.errors = [{ instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                return false;
            }
            else {
                const _errs1 = errors;
                for (const key0 in data) {
                    if (!((((key0 === "container") || (key0 === "host")) || (key0 === "process")) || (key0 === "service"))) {
                        let data0 = data[key0];
                        const _errs2 = errors;
                        if ((!(data0 && typeof data0 == "object" && !Array.isArray(data0))) && (data0 !== null)) {
                            validate121.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/additionalProperties/type", keyword: "type", params: { type: schema144.additionalProperties.type }, message: "must be object,null" }];
                            return false;
                        }
                        var valid0 = _errs2 === errors;
                        if (!valid0) {
                            break;
                        }
                    }
                }
                if (_errs1 === errors) {
                    if (data.container !== undefined) {
                        let data1 = data.container;
                        const _errs4 = errors;
                        const _errs5 = errors;
                        if ((!(data1 && typeof data1 == "object" && !Array.isArray(data1))) && (data1 !== null)) {
                            validate121.errors = [{ instancePath: instancePath + "/container", schemaPath: "#/$defs/ExperimentalContainerResourceDetector/type", keyword: "type", params: { type: schema145.type }, message: "must be object,null" }];
                            return false;
                        }
                        if (errors === _errs5) {
                            if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                                for (const key1 in data1) {
                                    validate121.errors = [{ instancePath: instancePath + "/container", schemaPath: "#/$defs/ExperimentalContainerResourceDetector/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                        }
                        var valid1 = _errs4 === errors;
                    }
                    else {
                        var valid1 = true;
                    }
                    if (valid1) {
                        if (data.host !== undefined) {
                            let data2 = data.host;
                            const _errs8 = errors;
                            const _errs9 = errors;
                            if ((!(data2 && typeof data2 == "object" && !Array.isArray(data2))) && (data2 !== null)) {
                                validate121.errors = [{ instancePath: instancePath + "/host", schemaPath: "#/$defs/ExperimentalHostResourceDetector/type", keyword: "type", params: { type: schema146.type }, message: "must be object,null" }];
                                return false;
                            }
                            if (errors === _errs9) {
                                if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                                    for (const key2 in data2) {
                                        validate121.errors = [{ instancePath: instancePath + "/host", schemaPath: "#/$defs/ExperimentalHostResourceDetector/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                            }
                            var valid1 = _errs8 === errors;
                        }
                        else {
                            var valid1 = true;
                        }
                        if (valid1) {
                            if (data.process !== undefined) {
                                let data3 = data.process;
                                const _errs12 = errors;
                                const _errs13 = errors;
                                if ((!(data3 && typeof data3 == "object" && !Array.isArray(data3))) && (data3 !== null)) {
                                    validate121.errors = [{ instancePath: instancePath + "/process", schemaPath: "#/$defs/ExperimentalProcessResourceDetector/type", keyword: "type", params: { type: schema147.type }, message: "must be object,null" }];
                                    return false;
                                }
                                if (errors === _errs13) {
                                    if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                        for (const key3 in data3) {
                                            validate121.errors = [{ instancePath: instancePath + "/process", schemaPath: "#/$defs/ExperimentalProcessResourceDetector/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                                            return false;
                                            break;
                                        }
                                    }
                                }
                                var valid1 = _errs12 === errors;
                            }
                            else {
                                var valid1 = true;
                            }
                            if (valid1) {
                                if (data.service !== undefined) {
                                    let data4 = data.service;
                                    const _errs16 = errors;
                                    const _errs17 = errors;
                                    if ((!(data4 && typeof data4 == "object" && !Array.isArray(data4))) && (data4 !== null)) {
                                        validate121.errors = [{ instancePath: instancePath + "/service", schemaPath: "#/$defs/ExperimentalServiceResourceDetector/type", keyword: "type", params: { type: schema148.type }, message: "must be object,null" }];
                                        return false;
                                    }
                                    if (errors === _errs17) {
                                        if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                                            for (const key4 in data4) {
                                                validate121.errors = [{ instancePath: instancePath + "/service", schemaPath: "#/$defs/ExperimentalServiceResourceDetector/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" }];
                                                return false;
                                                break;
                                            }
                                        }
                                    }
                                    var valid1 = _errs16 === errors;
                                }
                                else {
                                    var valid1 = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate121.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate121.errors = vErrors; return errors === 0; }
validate121.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate120(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate120.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((key0 === "attributes") || (key0 === "detectors"))) {
                validate120.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.attributes !== undefined) {
                let data0 = data.attributes;
                const _errs2 = errors;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!((key1 === "included") || (key1 === "excluded"))) {
                                validate120.errors = [{ instancePath: instancePath + "/attributes", schemaPath: "#/$defs/IncludeExclude/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.included !== undefined) {
                                let data1 = data0.included;
                                const _errs6 = errors;
                                if (errors === _errs6) {
                                    if (Array.isArray(data1)) {
                                        if (data1.length < 1) {
                                            validate120.errors = [{ instancePath: instancePath + "/attributes/included", schemaPath: "#/$defs/IncludeExclude/properties/included/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                            return false;
                                        }
                                        else {
                                            var valid3 = true;
                                            const len0 = data1.length;
                                            for (let i0 = 0; i0 < len0; i0++) {
                                                const _errs8 = errors;
                                                if (typeof data1[i0] !== "string") {
                                                    validate120.errors = [{ instancePath: instancePath + "/attributes/included/" + i0, schemaPath: "#/$defs/IncludeExclude/properties/included/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                    return false;
                                                }
                                                var valid3 = _errs8 === errors;
                                                if (!valid3) {
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    else {
                                        validate120.errors = [{ instancePath: instancePath + "/attributes/included", schemaPath: "#/$defs/IncludeExclude/properties/included/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                        return false;
                                    }
                                }
                                var valid2 = _errs6 === errors;
                            }
                            else {
                                var valid2 = true;
                            }
                            if (valid2) {
                                if (data0.excluded !== undefined) {
                                    let data3 = data0.excluded;
                                    const _errs10 = errors;
                                    if (errors === _errs10) {
                                        if (Array.isArray(data3)) {
                                            if (data3.length < 1) {
                                                validate120.errors = [{ instancePath: instancePath + "/attributes/excluded", schemaPath: "#/$defs/IncludeExclude/properties/excluded/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                return false;
                                            }
                                            else {
                                                var valid4 = true;
                                                const len1 = data3.length;
                                                for (let i1 = 0; i1 < len1; i1++) {
                                                    const _errs12 = errors;
                                                    if (typeof data3[i1] !== "string") {
                                                        validate120.errors = [{ instancePath: instancePath + "/attributes/excluded/" + i1, schemaPath: "#/$defs/IncludeExclude/properties/excluded/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                        return false;
                                                    }
                                                    var valid4 = _errs12 === errors;
                                                    if (!valid4) {
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        else {
                                            validate120.errors = [{ instancePath: instancePath + "/attributes/excluded", schemaPath: "#/$defs/IncludeExclude/properties/excluded/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                            return false;
                                        }
                                    }
                                    var valid2 = _errs10 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                            }
                        }
                    }
                    else {
                        validate120.errors = [{ instancePath: instancePath + "/attributes", schemaPath: "#/$defs/IncludeExclude/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.detectors !== undefined) {
                    let data5 = data.detectors;
                    const _errs14 = errors;
                    if (errors === _errs14) {
                        if (Array.isArray(data5)) {
                            if (data5.length < 1) {
                                validate120.errors = [{ instancePath: instancePath + "/detectors", schemaPath: "#/properties/detectors/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                return false;
                            }
                            else {
                                var valid5 = true;
                                const len2 = data5.length;
                                for (let i2 = 0; i2 < len2; i2++) {
                                    const _errs16 = errors;
                                    if (!(validate121(data5[i2], { instancePath: instancePath + "/detectors/" + i2, parentData: data5, parentDataProperty: i2, rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate121.errors : vErrors.concat(validate121.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid5 = _errs16 === errors;
                                    if (!valid5) {
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            validate120.errors = [{ instancePath: instancePath + "/detectors", schemaPath: "#/properties/detectors/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                        }
                    }
                    var valid0 = _errs14 === errors;
                }
                else {
                    var valid0 = true;
                }
            }
        }
    }
    else {
        validate120.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate120.errors = vErrors; return errors === 0; }
validate120.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate117(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate117.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((((key0 === "attributes") || (key0 === "detection/development")) || (key0 === "schema_url")) || (key0 === "attributes_list"))) {
                validate117.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.attributes !== undefined) {
                let data0 = data.attributes;
                const _errs2 = errors;
                if (errors === _errs2) {
                    if (Array.isArray(data0)) {
                        if (data0.length < 1) {
                            validate117.errors = [{ instancePath: instancePath + "/attributes", schemaPath: "#/properties/attributes/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                            return false;
                        }
                        else {
                            var valid1 = true;
                            const len0 = data0.length;
                            for (let i0 = 0; i0 < len0; i0++) {
                                const _errs4 = errors;
                                if (!(validate118(data0[i0], { instancePath: instancePath + "/attributes/" + i0, parentData: data0, parentDataProperty: i0, rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
                                    errors = vErrors.length;
                                }
                                var valid1 = _errs4 === errors;
                                if (!valid1) {
                                    break;
                                }
                            }
                        }
                    }
                    else {
                        validate117.errors = [{ instancePath: instancePath + "/attributes", schemaPath: "#/properties/attributes/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                        return false;
                    }
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data["detection/development"] !== undefined) {
                    const _errs5 = errors;
                    if (!(validate120(data["detection/development"], { instancePath: instancePath + "/detection~1development", parentData: data, parentDataProperty: "detection/development", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? validate120.errors : vErrors.concat(validate120.errors);
                        errors = vErrors.length;
                    }
                    var valid0 = _errs5 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.schema_url !== undefined) {
                        let data3 = data.schema_url;
                        const _errs6 = errors;
                        if ((typeof data3 !== "string") && (data3 !== null)) {
                            validate117.errors = [{ instancePath: instancePath + "/schema_url", schemaPath: "#/properties/schema_url/type", keyword: "type", params: { type: schema139.properties.schema_url.type }, message: "must be string,null" }];
                            return false;
                        }
                        var valid0 = _errs6 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.attributes_list !== undefined) {
                            let data4 = data.attributes_list;
                            const _errs8 = errors;
                            if ((typeof data4 !== "string") && (data4 !== null)) {
                                validate117.errors = [{ instancePath: instancePath + "/attributes_list", schemaPath: "#/properties/attributes_list/type", keyword: "type", params: { type: schema139.properties.attributes_list.type }, message: "must be string,null" }];
                                return false;
                            }
                            var valid0 = _errs8 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                    }
                }
            }
        }
    }
    else {
        validate117.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate117.errors = vErrors; return errors === 0; }
validate117.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema149 = { "type": "object", "additionalProperties": false, "properties": { "general": { "$ref": "#/$defs/ExperimentalGeneralInstrumentation", "description": "Configure general SemConv options that may apply to multiple languages and instrumentations.\nInstrumenation may merge general config options with the language specific configuration at .instrumentation.<language>.\nIf omitted, default values as described in ExperimentalGeneralInstrumentation are used.\n" }, "cpp": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure C++ language-specific instrumentation libraries.\nIf omitted, instrumentation defaults are used.\n" }, "dotnet": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure .NET language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "erlang": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Erlang language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "go": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Go language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "java": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Java language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "js": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure JavaScript language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "php": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure PHP language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "python": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Python language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "ruby": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Ruby language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "rust": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Rust language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" }, "swift": { "$ref": "#/$defs/ExperimentalLanguageSpecificInstrumentation", "description": "Configure Swift language-specific instrumentation libraries.\nEach entry's key identifies a particular instrumentation library. The corresponding value configures it.\nIf omitted, instrumentation defaults are used.\n" } } };
const schema167 = { "type": "object", "additionalProperties": { "type": "object" } };
const schema150 = { "type": "object", "additionalProperties": false, "properties": { "http": { "$ref": "#/$defs/ExperimentalHttpInstrumentation", "description": "Configure instrumentations following the http semantic conventions.\nSee http semantic conventions: https://opentelemetry.io/docs/specs/semconv/http/\nIf omitted, defaults as described in ExperimentalHttpInstrumentation are used.\n" }, "code": { "$ref": "#/$defs/ExperimentalCodeInstrumentation", "description": "Configure instrumentations following the code semantic conventions.\nSee code semantic conventions: https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/\nIf omitted, defaults as described in ExperimentalCodeInstrumentation are used.\n" }, "db": { "$ref": "#/$defs/ExperimentalDbInstrumentation", "description": "Configure instrumentations following the database semantic conventions.\nSee database semantic conventions: https://opentelemetry.io/docs/specs/semconv/database/\nIf omitted, defaults as described in ExperimentalDbInstrumentation are used.\n" }, "gen_ai": { "$ref": "#/$defs/ExperimentalGenAiInstrumentation", "description": "Configure instrumentations following the GenAI semantic conventions.\nSee GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/\nIf omitted, defaults as described in ExperimentalGenAiInstrumentation are used.\n" }, "messaging": { "$ref": "#/$defs/ExperimentalMessagingInstrumentation", "description": "Configure instrumentations following the messaging semantic conventions.\nSee messaging semantic conventions: https://opentelemetry.io/docs/specs/semconv/messaging/\nIf omitted, defaults as described in ExperimentalMessagingInstrumentation are used.\n" }, "rpc": { "$ref": "#/$defs/ExperimentalRpcInstrumentation", "description": "Configure instrumentations following the RPC semantic conventions.\nSee RPC semantic conventions: https://opentelemetry.io/docs/specs/semconv/rpc/\nIf omitted, defaults as described in ExperimentalRpcInstrumentation are used.\n" }, "sanitization": { "$ref": "#/$defs/ExperimentalSanitization", "description": "Configure general sanitization options.\nIf omitted, defaults as described in ExperimentalSanitization are used.\n" }, "stability_opt_in_list": { "type": ["string", "null"], "description": "Configure semantic convention stability opt-in as a comma-separated list.\nThis property follows the format and semantics of the OTEL_SEMCONV_STABILITY_OPT_IN environment variable.\nControls the emission of stable vs. experimental semantic conventions for instrumentation.\nThis setting is only intended for migrating from experimental to stable semantic conventions.\n\nKnown values include:\n- http: Emit stable HTTP and networking conventions only\n- http/dup: Emit both old and stable HTTP and networking conventions (for phased migration)\n- database: Emit stable database conventions only\n- database/dup: Emit both old and stable database conventions (for phased migration)\n- rpc: Emit stable RPC conventions only\n- rpc/dup: Emit both experimental and stable RPC conventions (for phased migration)\n- messaging: Emit stable messaging conventions only\n- messaging/dup: Emit both old and stable messaging conventions (for phased migration)\n- code: Emit stable code conventions only\n- code/dup: Emit both old and stable code conventions (for phased migration)\n\nMultiple values can be specified as a comma-separated list (e.g., \"http,database/dup\").\nAdditional signal types may be supported in future versions.\n\nDomain-specific semconv properties (e.g., .instrumentation/development.general.db.semconv) take precedence over this general setting.\n\nSee:\n- HTTP migration: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/\n- Database migration: https://opentelemetry.io/docs/specs/semconv/database/\n- RPC: https://opentelemetry.io/docs/specs/semconv/rpc/\n- Messaging: https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/\nIf omitted or null, no opt-in is configured and instrumentations continue emitting their default semantic convention version.\n" } } };
const schema151 = { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure HTTP semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee HTTP migration: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" }, "client": { "$ref": "#/$defs/ExperimentalHttpClientInstrumentation", "description": "Configure instrumentations following the http client semantic conventions.\nIf omitted, defaults as described in ExperimentalHttpClientInstrumentation are used.\n" }, "server": { "$ref": "#/$defs/ExperimentalHttpServerInstrumentation", "description": "Configure instrumentations following the http server semantic conventions.\nIf omitted, defaults as described in ExperimentalHttpServerInstrumentation are used.\n" } } };
const schema152 = { "type": "object", "additionalProperties": false, "properties": { "version": { "type": ["integer", "null"], "minimum": 0, "description": "The target semantic convention version for this domain (e.g., 1).\nIf omitted or null, the latest stable version is used, or if no stable version is available and .experimental is true then the latest experimental version is used.\n" }, "experimental": { "type": ["boolean", "null"], "description": "Use latest experimental semantic conventions (before stable is available or to enable experimental features on top of stable conventions).\nIf omitted or null, false is used.\n" }, "dual_emit": { "type": ["boolean", "null"], "description": "When true, also emit the previous major version alongside the target version.\nFor version=1, the previous version refers to the pre-stable conventions that the instrumentation emitted before the first stable semantic convention version was defined.\nFor version=2 and above, the previous version is the prior stable major version (e.g., version=2, dual_emit=true emits both v2 and v1).\nEnables dual-emit for phased migration between versions.\nIf omitted or null, false is used.\n" } } };
const schema153 = { "type": "object", "additionalProperties": false, "properties": { "request_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for outbound http requests.\nIf omitted, no outbound request headers are captured.\n" }, "response_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for inbound http responses.\nIf omitted, no inbound response headers are captured.\n" }, "known_methods": { "type": "array", "minItems": 0, "items": { "type": "string" }, "description": "Override the default list of known HTTP methods.\nKnown methods are case-sensitive.\nThis is a full override of the default known methods, not a list of known methods in addition to the defaults.\nIf omitted, HTTP methods GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH are known.\n" } } };
const schema154 = { "type": "object", "additionalProperties": false, "properties": { "request_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for inbound http requests.\nIf omitted, no request headers are captured.\n" }, "response_captured_headers": { "type": "array", "minItems": 1, "items": { "type": "string" }, "description": "Configure headers to capture for outbound http responses.\nIf omitted, no response headers are captures.\n" }, "known_methods": { "type": "array", "minItems": 0, "items": { "type": "string" }, "description": "Override the default list of known HTTP methods.\nKnown methods are case-sensitive.\nThis is a full override of the default known methods, not a list of known methods in addition to the defaults.\nIf omitted, HTTP methods GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH are known.\n" } } };
function validate127(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate127.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(((key0 === "semconv") || (key0 === "client")) || (key0 === "server"))) {
                validate127.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.semconv !== undefined) {
                let data0 = data.semconv;
                const _errs2 = errors;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(((key1 === "version") || (key1 === "experimental")) || (key1 === "dual_emit"))) {
                                validate127.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.version !== undefined) {
                                let data1 = data0.version;
                                const _errs6 = errors;
                                if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                                    validate127.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/type", keyword: "type", params: { type: schema152.properties.version.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs6) {
                                    if (typeof data1 == "number") {
                                        if (data1 < 0 || isNaN(data1)) {
                                            validate127.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid2 = _errs6 === errors;
                            }
                            else {
                                var valid2 = true;
                            }
                            if (valid2) {
                                if (data0.experimental !== undefined) {
                                    let data2 = data0.experimental;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "boolean") && (data2 !== null)) {
                                        validate127.errors = [{ instancePath: instancePath + "/semconv/experimental", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/experimental/type", keyword: "type", params: { type: schema152.properties.experimental.type }, message: "must be boolean,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data0.dual_emit !== undefined) {
                                        let data3 = data0.dual_emit;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "boolean") && (data3 !== null)) {
                                            validate127.errors = [{ instancePath: instancePath + "/semconv/dual_emit", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/dual_emit/type", keyword: "type", params: { type: schema152.properties.dual_emit.type }, message: "must be boolean,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                }
                            }
                        }
                    }
                    else {
                        validate127.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.client !== undefined) {
                    let data4 = data.client;
                    const _errs12 = errors;
                    const _errs13 = errors;
                    if (errors === _errs13) {
                        if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                            const _errs15 = errors;
                            for (const key2 in data4) {
                                if (!(((key2 === "request_captured_headers") || (key2 === "response_captured_headers")) || (key2 === "known_methods"))) {
                                    validate127.errors = [{ instancePath: instancePath + "/client", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                    return false;
                                    break;
                                }
                            }
                            if (_errs15 === errors) {
                                if (data4.request_captured_headers !== undefined) {
                                    let data5 = data4.request_captured_headers;
                                    const _errs16 = errors;
                                    if (errors === _errs16) {
                                        if (Array.isArray(data5)) {
                                            if (data5.length < 1) {
                                                validate127.errors = [{ instancePath: instancePath + "/client/request_captured_headers", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/request_captured_headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                return false;
                                            }
                                            else {
                                                var valid5 = true;
                                                const len0 = data5.length;
                                                for (let i0 = 0; i0 < len0; i0++) {
                                                    const _errs18 = errors;
                                                    if (typeof data5[i0] !== "string") {
                                                        validate127.errors = [{ instancePath: instancePath + "/client/request_captured_headers/" + i0, schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/request_captured_headers/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                        return false;
                                                    }
                                                    var valid5 = _errs18 === errors;
                                                    if (!valid5) {
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        else {
                                            validate127.errors = [{ instancePath: instancePath + "/client/request_captured_headers", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/request_captured_headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                            return false;
                                        }
                                    }
                                    var valid4 = _errs16 === errors;
                                }
                                else {
                                    var valid4 = true;
                                }
                                if (valid4) {
                                    if (data4.response_captured_headers !== undefined) {
                                        let data7 = data4.response_captured_headers;
                                        const _errs20 = errors;
                                        if (errors === _errs20) {
                                            if (Array.isArray(data7)) {
                                                if (data7.length < 1) {
                                                    validate127.errors = [{ instancePath: instancePath + "/client/response_captured_headers", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/response_captured_headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                    return false;
                                                }
                                                else {
                                                    var valid6 = true;
                                                    const len1 = data7.length;
                                                    for (let i1 = 0; i1 < len1; i1++) {
                                                        const _errs22 = errors;
                                                        if (typeof data7[i1] !== "string") {
                                                            validate127.errors = [{ instancePath: instancePath + "/client/response_captured_headers/" + i1, schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/response_captured_headers/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                            return false;
                                                        }
                                                        var valid6 = _errs22 === errors;
                                                        if (!valid6) {
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                validate127.errors = [{ instancePath: instancePath + "/client/response_captured_headers", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/response_captured_headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                return false;
                                            }
                                        }
                                        var valid4 = _errs20 === errors;
                                    }
                                    else {
                                        var valid4 = true;
                                    }
                                    if (valid4) {
                                        if (data4.known_methods !== undefined) {
                                            let data9 = data4.known_methods;
                                            const _errs24 = errors;
                                            if (errors === _errs24) {
                                                if (Array.isArray(data9)) {
                                                    if (data9.length < 0) {
                                                        validate127.errors = [{ instancePath: instancePath + "/client/known_methods", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/known_methods/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" }];
                                                        return false;
                                                    }
                                                    else {
                                                        var valid7 = true;
                                                        const len2 = data9.length;
                                                        for (let i2 = 0; i2 < len2; i2++) {
                                                            const _errs26 = errors;
                                                            if (typeof data9[i2] !== "string") {
                                                                validate127.errors = [{ instancePath: instancePath + "/client/known_methods/" + i2, schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/known_methods/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                return false;
                                                            }
                                                            var valid7 = _errs26 === errors;
                                                            if (!valid7) {
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                                else {
                                                    validate127.errors = [{ instancePath: instancePath + "/client/known_methods", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/properties/known_methods/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                    return false;
                                                }
                                            }
                                            var valid4 = _errs24 === errors;
                                        }
                                        else {
                                            var valid4 = true;
                                        }
                                    }
                                }
                            }
                        }
                        else {
                            validate127.errors = [{ instancePath: instancePath + "/client", schemaPath: "#/$defs/ExperimentalHttpClientInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                            return false;
                        }
                    }
                    var valid0 = _errs12 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.server !== undefined) {
                        let data11 = data.server;
                        const _errs28 = errors;
                        const _errs29 = errors;
                        if (errors === _errs29) {
                            if (data11 && typeof data11 == "object" && !Array.isArray(data11)) {
                                const _errs31 = errors;
                                for (const key3 in data11) {
                                    if (!(((key3 === "request_captured_headers") || (key3 === "response_captured_headers")) || (key3 === "known_methods"))) {
                                        validate127.errors = [{ instancePath: instancePath + "/server", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                                        return false;
                                        break;
                                    }
                                }
                                if (_errs31 === errors) {
                                    if (data11.request_captured_headers !== undefined) {
                                        let data12 = data11.request_captured_headers;
                                        const _errs32 = errors;
                                        if (errors === _errs32) {
                                            if (Array.isArray(data12)) {
                                                if (data12.length < 1) {
                                                    validate127.errors = [{ instancePath: instancePath + "/server/request_captured_headers", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/request_captured_headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                    return false;
                                                }
                                                else {
                                                    var valid10 = true;
                                                    const len3 = data12.length;
                                                    for (let i3 = 0; i3 < len3; i3++) {
                                                        const _errs34 = errors;
                                                        if (typeof data12[i3] !== "string") {
                                                            validate127.errors = [{ instancePath: instancePath + "/server/request_captured_headers/" + i3, schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/request_captured_headers/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                            return false;
                                                        }
                                                        var valid10 = _errs34 === errors;
                                                        if (!valid10) {
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                validate127.errors = [{ instancePath: instancePath + "/server/request_captured_headers", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/request_captured_headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                return false;
                                            }
                                        }
                                        var valid9 = _errs32 === errors;
                                    }
                                    else {
                                        var valid9 = true;
                                    }
                                    if (valid9) {
                                        if (data11.response_captured_headers !== undefined) {
                                            let data14 = data11.response_captured_headers;
                                            const _errs36 = errors;
                                            if (errors === _errs36) {
                                                if (Array.isArray(data14)) {
                                                    if (data14.length < 1) {
                                                        validate127.errors = [{ instancePath: instancePath + "/server/response_captured_headers", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/response_captured_headers/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" }];
                                                        return false;
                                                    }
                                                    else {
                                                        var valid11 = true;
                                                        const len4 = data14.length;
                                                        for (let i4 = 0; i4 < len4; i4++) {
                                                            const _errs38 = errors;
                                                            if (typeof data14[i4] !== "string") {
                                                                validate127.errors = [{ instancePath: instancePath + "/server/response_captured_headers/" + i4, schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/response_captured_headers/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                return false;
                                                            }
                                                            var valid11 = _errs38 === errors;
                                                            if (!valid11) {
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                                else {
                                                    validate127.errors = [{ instancePath: instancePath + "/server/response_captured_headers", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/response_captured_headers/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                    return false;
                                                }
                                            }
                                            var valid9 = _errs36 === errors;
                                        }
                                        else {
                                            var valid9 = true;
                                        }
                                        if (valid9) {
                                            if (data11.known_methods !== undefined) {
                                                let data16 = data11.known_methods;
                                                const _errs40 = errors;
                                                if (errors === _errs40) {
                                                    if (Array.isArray(data16)) {
                                                        if (data16.length < 0) {
                                                            validate127.errors = [{ instancePath: instancePath + "/server/known_methods", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/known_methods/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" }];
                                                            return false;
                                                        }
                                                        else {
                                                            var valid12 = true;
                                                            const len5 = data16.length;
                                                            for (let i5 = 0; i5 < len5; i5++) {
                                                                const _errs42 = errors;
                                                                if (typeof data16[i5] !== "string") {
                                                                    validate127.errors = [{ instancePath: instancePath + "/server/known_methods/" + i5, schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/known_methods/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                                    return false;
                                                                }
                                                                var valid12 = _errs42 === errors;
                                                                if (!valid12) {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        validate127.errors = [{ instancePath: instancePath + "/server/known_methods", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/properties/known_methods/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                        return false;
                                                    }
                                                }
                                                var valid9 = _errs40 === errors;
                                            }
                                            else {
                                                var valid9 = true;
                                            }
                                        }
                                    }
                                }
                            }
                            else {
                                validate127.errors = [{ instancePath: instancePath + "/server", schemaPath: "#/$defs/ExperimentalHttpServerInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                return false;
                            }
                        }
                        var valid0 = _errs28 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                }
            }
        }
    }
    else {
        validate127.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate127.errors = vErrors; return errors === 0; }
validate127.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema155 = { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure code semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee code semantic conventions: https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } };
function validate129(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate129.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(key0 === "semconv")) {
                validate129.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.semconv !== undefined) {
                let data0 = data.semconv;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(((key1 === "version") || (key1 === "experimental")) || (key1 === "dual_emit"))) {
                                validate129.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.version !== undefined) {
                                let data1 = data0.version;
                                const _errs6 = errors;
                                if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                                    validate129.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/type", keyword: "type", params: { type: schema152.properties.version.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs6) {
                                    if (typeof data1 == "number") {
                                        if (data1 < 0 || isNaN(data1)) {
                                            validate129.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid2 = _errs6 === errors;
                            }
                            else {
                                var valid2 = true;
                            }
                            if (valid2) {
                                if (data0.experimental !== undefined) {
                                    let data2 = data0.experimental;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "boolean") && (data2 !== null)) {
                                        validate129.errors = [{ instancePath: instancePath + "/semconv/experimental", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/experimental/type", keyword: "type", params: { type: schema152.properties.experimental.type }, message: "must be boolean,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data0.dual_emit !== undefined) {
                                        let data3 = data0.dual_emit;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "boolean") && (data3 !== null)) {
                                            validate129.errors = [{ instancePath: instancePath + "/semconv/dual_emit", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/dual_emit/type", keyword: "type", params: { type: schema152.properties.dual_emit.type }, message: "must be boolean,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                }
                            }
                        }
                    }
                    else {
                        validate129.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
            }
        }
    }
    else {
        validate129.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate129.errors = vErrors; return errors === 0; }
validate129.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema157 = { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure database semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee database migration: https://opentelemetry.io/docs/specs/semconv/database/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } };
function validate131(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate131.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(key0 === "semconv")) {
                validate131.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.semconv !== undefined) {
                let data0 = data.semconv;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(((key1 === "version") || (key1 === "experimental")) || (key1 === "dual_emit"))) {
                                validate131.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.version !== undefined) {
                                let data1 = data0.version;
                                const _errs6 = errors;
                                if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                                    validate131.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/type", keyword: "type", params: { type: schema152.properties.version.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs6) {
                                    if (typeof data1 == "number") {
                                        if (data1 < 0 || isNaN(data1)) {
                                            validate131.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid2 = _errs6 === errors;
                            }
                            else {
                                var valid2 = true;
                            }
                            if (valid2) {
                                if (data0.experimental !== undefined) {
                                    let data2 = data0.experimental;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "boolean") && (data2 !== null)) {
                                        validate131.errors = [{ instancePath: instancePath + "/semconv/experimental", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/experimental/type", keyword: "type", params: { type: schema152.properties.experimental.type }, message: "must be boolean,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data0.dual_emit !== undefined) {
                                        let data3 = data0.dual_emit;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "boolean") && (data3 !== null)) {
                                            validate131.errors = [{ instancePath: instancePath + "/semconv/dual_emit", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/dual_emit/type", keyword: "type", params: { type: schema152.properties.dual_emit.type }, message: "must be boolean,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                }
                            }
                        }
                    }
                    else {
                        validate131.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
            }
        }
    }
    else {
        validate131.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate131.errors = vErrors; return errors === 0; }
validate131.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema159 = { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure GenAI semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } };
function validate133(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate133.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(key0 === "semconv")) {
                validate133.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.semconv !== undefined) {
                let data0 = data.semconv;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(((key1 === "version") || (key1 === "experimental")) || (key1 === "dual_emit"))) {
                                validate133.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.version !== undefined) {
                                let data1 = data0.version;
                                const _errs6 = errors;
                                if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                                    validate133.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/type", keyword: "type", params: { type: schema152.properties.version.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs6) {
                                    if (typeof data1 == "number") {
                                        if (data1 < 0 || isNaN(data1)) {
                                            validate133.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid2 = _errs6 === errors;
                            }
                            else {
                                var valid2 = true;
                            }
                            if (valid2) {
                                if (data0.experimental !== undefined) {
                                    let data2 = data0.experimental;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "boolean") && (data2 !== null)) {
                                        validate133.errors = [{ instancePath: instancePath + "/semconv/experimental", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/experimental/type", keyword: "type", params: { type: schema152.properties.experimental.type }, message: "must be boolean,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data0.dual_emit !== undefined) {
                                        let data3 = data0.dual_emit;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "boolean") && (data3 !== null)) {
                                            validate133.errors = [{ instancePath: instancePath + "/semconv/dual_emit", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/dual_emit/type", keyword: "type", params: { type: schema152.properties.dual_emit.type }, message: "must be boolean,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                }
                            }
                        }
                    }
                    else {
                        validate133.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
            }
        }
    }
    else {
        validate133.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate133.errors = vErrors; return errors === 0; }
validate133.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema161 = { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure messaging semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee messaging semantic conventions: https://opentelemetry.io/docs/specs/semconv/messaging/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } };
function validate135(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate135.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(key0 === "semconv")) {
                validate135.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.semconv !== undefined) {
                let data0 = data.semconv;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(((key1 === "version") || (key1 === "experimental")) || (key1 === "dual_emit"))) {
                                validate135.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.version !== undefined) {
                                let data1 = data0.version;
                                const _errs6 = errors;
                                if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                                    validate135.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/type", keyword: "type", params: { type: schema152.properties.version.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs6) {
                                    if (typeof data1 == "number") {
                                        if (data1 < 0 || isNaN(data1)) {
                                            validate135.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid2 = _errs6 === errors;
                            }
                            else {
                                var valid2 = true;
                            }
                            if (valid2) {
                                if (data0.experimental !== undefined) {
                                    let data2 = data0.experimental;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "boolean") && (data2 !== null)) {
                                        validate135.errors = [{ instancePath: instancePath + "/semconv/experimental", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/experimental/type", keyword: "type", params: { type: schema152.properties.experimental.type }, message: "must be boolean,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data0.dual_emit !== undefined) {
                                        let data3 = data0.dual_emit;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "boolean") && (data3 !== null)) {
                                            validate135.errors = [{ instancePath: instancePath + "/semconv/dual_emit", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/dual_emit/type", keyword: "type", params: { type: schema152.properties.dual_emit.type }, message: "must be boolean,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                }
                            }
                        }
                    }
                    else {
                        validate135.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
            }
        }
    }
    else {
        validate135.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate135.errors = vErrors; return errors === 0; }
validate135.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema163 = { "type": "object", "additionalProperties": false, "properties": { "semconv": { "$ref": "#/$defs/ExperimentalSemconvConfig", "description": "Configure RPC semantic convention version and migration behavior.\n\nThis property takes precedence over the .instrumentation/development.general.stability_opt_in_list setting.\n\nSee RPC semantic conventions: https://opentelemetry.io/docs/specs/semconv/rpc/\nIf omitted, uses the general stability_opt_in_list setting, or instrumentations continue emitting their default semantic convention version if not set.\n" } } };
function validate137(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate137.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(key0 === "semconv")) {
                validate137.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.semconv !== undefined) {
                let data0 = data.semconv;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(((key1 === "version") || (key1 === "experimental")) || (key1 === "dual_emit"))) {
                                validate137.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.version !== undefined) {
                                let data1 = data0.version;
                                const _errs6 = errors;
                                if ((!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))) && (data1 !== null)) {
                                    validate137.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/type", keyword: "type", params: { type: schema152.properties.version.type }, message: "must be integer,null" }];
                                    return false;
                                }
                                if (errors === _errs6) {
                                    if (typeof data1 == "number") {
                                        if (data1 < 0 || isNaN(data1)) {
                                            validate137.errors = [{ instancePath: instancePath + "/semconv/version", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/version/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                            return false;
                                        }
                                    }
                                }
                                var valid2 = _errs6 === errors;
                            }
                            else {
                                var valid2 = true;
                            }
                            if (valid2) {
                                if (data0.experimental !== undefined) {
                                    let data2 = data0.experimental;
                                    const _errs8 = errors;
                                    if ((typeof data2 !== "boolean") && (data2 !== null)) {
                                        validate137.errors = [{ instancePath: instancePath + "/semconv/experimental", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/experimental/type", keyword: "type", params: { type: schema152.properties.experimental.type }, message: "must be boolean,null" }];
                                        return false;
                                    }
                                    var valid2 = _errs8 === errors;
                                }
                                else {
                                    var valid2 = true;
                                }
                                if (valid2) {
                                    if (data0.dual_emit !== undefined) {
                                        let data3 = data0.dual_emit;
                                        const _errs10 = errors;
                                        if ((typeof data3 !== "boolean") && (data3 !== null)) {
                                            validate137.errors = [{ instancePath: instancePath + "/semconv/dual_emit", schemaPath: "#/$defs/ExperimentalSemconvConfig/properties/dual_emit/type", keyword: "type", params: { type: schema152.properties.dual_emit.type }, message: "must be boolean,null" }];
                                            return false;
                                        }
                                        var valid2 = _errs10 === errors;
                                    }
                                    else {
                                        var valid2 = true;
                                    }
                                }
                            }
                        }
                    }
                    else {
                        validate137.errors = [{ instancePath: instancePath + "/semconv", schemaPath: "#/$defs/ExperimentalSemconvConfig/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
            }
        }
    }
    else {
        validate137.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate137.errors = vErrors; return errors === 0; }
validate137.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
const schema165 = { "type": "object", "additionalProperties": false, "properties": { "url": { "$ref": "#/$defs/ExperimentalUrlSanitization", "description": "Configure URL sanitization options.\nIf omitted, defaults as described in ExperimentalUrlSanitization are used.\n" } } };
const schema166 = { "type": "object", "additionalProperties": false, "properties": { "sensitive_query_parameters": { "type": "array", "minItems": 0, "items": { "type": "string" }, "description": "List of query parameter names whose values should be redacted from URLs.\nQuery parameter names are case-sensitive.\nThis is a full override of the default sensitive query parameter keys, it is not a list of keys in addition to the defaults.\nSet to an empty array to disable query parameter redaction.\nIf omitted, the default sensitive query parameter list as defined by the url semantic conventions (https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/url.md) is used.\n" } } };
function validate139(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate139.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(key0 === "url")) {
                validate139.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.url !== undefined) {
                let data0 = data.url;
                const _errs3 = errors;
                if (errors === _errs3) {
                    if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
                        const _errs5 = errors;
                        for (const key1 in data0) {
                            if (!(key1 === "sensitive_query_parameters")) {
                                validate139.errors = [{ instancePath: instancePath + "/url", schemaPath: "#/$defs/ExperimentalUrlSanitization/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                            }
                        }
                        if (_errs5 === errors) {
                            if (data0.sensitive_query_parameters !== undefined) {
                                let data1 = data0.sensitive_query_parameters;
                                const _errs6 = errors;
                                if (errors === _errs6) {
                                    if (Array.isArray(data1)) {
                                        if (data1.length < 0) {
                                            validate139.errors = [{ instancePath: instancePath + "/url/sensitive_query_parameters", schemaPath: "#/$defs/ExperimentalUrlSanitization/properties/sensitive_query_parameters/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" }];
                                            return false;
                                        }
                                        else {
                                            var valid3 = true;
                                            const len0 = data1.length;
                                            for (let i0 = 0; i0 < len0; i0++) {
                                                const _errs8 = errors;
                                                if (typeof data1[i0] !== "string") {
                                                    validate139.errors = [{ instancePath: instancePath + "/url/sensitive_query_parameters/" + i0, schemaPath: "#/$defs/ExperimentalUrlSanitization/properties/sensitive_query_parameters/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                    return false;
                                                }
                                                var valid3 = _errs8 === errors;
                                                if (!valid3) {
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    else {
                                        validate139.errors = [{ instancePath: instancePath + "/url/sensitive_query_parameters", schemaPath: "#/$defs/ExperimentalUrlSanitization/properties/sensitive_query_parameters/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                    else {
                        validate139.errors = [{ instancePath: instancePath + "/url", schemaPath: "#/$defs/ExperimentalUrlSanitization/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                    }
                }
            }
        }
    }
    else {
        validate139.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate139.errors = vErrors; return errors === 0; }
validate139.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate126(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate126.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!((((((((key0 === "http") || (key0 === "code")) || (key0 === "db")) || (key0 === "gen_ai")) || (key0 === "messaging")) || (key0 === "rpc")) || (key0 === "sanitization")) || (key0 === "stability_opt_in_list"))) {
                validate126.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.http !== undefined) {
                const _errs2 = errors;
                if (!(validate127(data.http, { instancePath: instancePath + "/http", parentData: data, parentDataProperty: "http", rootData, dynamicAnchors }))) {
                    vErrors = vErrors === null ? validate127.errors : vErrors.concat(validate127.errors);
                    errors = vErrors.length;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.code !== undefined) {
                    const _errs3 = errors;
                    if (!(validate129(data.code, { instancePath: instancePath + "/code", parentData: data, parentDataProperty: "code", rootData, dynamicAnchors }))) {
                        vErrors = vErrors === null ? validate129.errors : vErrors.concat(validate129.errors);
                        errors = vErrors.length;
                    }
                    var valid0 = _errs3 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.db !== undefined) {
                        const _errs4 = errors;
                        if (!(validate131(data.db, { instancePath: instancePath + "/db", parentData: data, parentDataProperty: "db", rootData, dynamicAnchors }))) {
                            vErrors = vErrors === null ? validate131.errors : vErrors.concat(validate131.errors);
                            errors = vErrors.length;
                        }
                        var valid0 = _errs4 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.gen_ai !== undefined) {
                            const _errs5 = errors;
                            if (!(validate133(data.gen_ai, { instancePath: instancePath + "/gen_ai", parentData: data, parentDataProperty: "gen_ai", rootData, dynamicAnchors }))) {
                                vErrors = vErrors === null ? validate133.errors : vErrors.concat(validate133.errors);
                                errors = vErrors.length;
                            }
                            var valid0 = _errs5 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.messaging !== undefined) {
                                const _errs6 = errors;
                                if (!(validate135(data.messaging, { instancePath: instancePath + "/messaging", parentData: data, parentDataProperty: "messaging", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate135.errors : vErrors.concat(validate135.errors);
                                    errors = vErrors.length;
                                }
                                var valid0 = _errs6 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.rpc !== undefined) {
                                    const _errs7 = errors;
                                    if (!(validate137(data.rpc, { instancePath: instancePath + "/rpc", parentData: data, parentDataProperty: "rpc", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate137.errors : vErrors.concat(validate137.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid0 = _errs7 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.sanitization !== undefined) {
                                        const _errs8 = errors;
                                        if (!(validate139(data.sanitization, { instancePath: instancePath + "/sanitization", parentData: data, parentDataProperty: "sanitization", rootData, dynamicAnchors }))) {
                                            vErrors = vErrors === null ? validate139.errors : vErrors.concat(validate139.errors);
                                            errors = vErrors.length;
                                        }
                                        var valid0 = _errs8 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                    if (valid0) {
                                        if (data.stability_opt_in_list !== undefined) {
                                            let data7 = data.stability_opt_in_list;
                                            const _errs9 = errors;
                                            if ((typeof data7 !== "string") && (data7 !== null)) {
                                                validate126.errors = [{ instancePath: instancePath + "/stability_opt_in_list", schemaPath: "#/properties/stability_opt_in_list/type", keyword: "type", params: { type: schema150.properties.stability_opt_in_list.type }, message: "must be string,null" }];
                                                return false;
                                            }
                                            var valid0 = _errs9 === errors;
                                        }
                                        else {
                                            var valid0 = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate126.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate126.errors = vErrors; return errors === 0; }
validate126.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate125(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate125.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        const _errs1 = errors;
        for (const key0 in data) {
            if (!(func1.call(schema149.properties, key0))) {
                validate125.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                return false;
                break;
            }
        }
        if (_errs1 === errors) {
            if (data.general !== undefined) {
                const _errs2 = errors;
                if (!(validate126(data.general, { instancePath: instancePath + "/general", parentData: data, parentDataProperty: "general", rootData, dynamicAnchors }))) {
                    vErrors = vErrors === null ? validate126.errors : vErrors.concat(validate126.errors);
                    errors = vErrors.length;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.cpp !== undefined) {
                    let data1 = data.cpp;
                    const _errs3 = errors;
                    const _errs4 = errors;
                    if (errors === _errs4) {
                        if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                            for (const key1 in data1) {
                                let data2 = data1[key1];
                                const _errs7 = errors;
                                if (!(data2 && typeof data2 == "object" && !Array.isArray(data2))) {
                                    validate125.errors = [{ instancePath: instancePath + "/cpp/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                    return false;
                                }
                                var valid2 = _errs7 === errors;
                                if (!valid2) {
                                    break;
                                }
                            }
                        }
                        else {
                            validate125.errors = [{ instancePath: instancePath + "/cpp", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                            return false;
                        }
                    }
                    var valid0 = _errs3 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.dotnet !== undefined) {
                        let data3 = data.dotnet;
                        const _errs9 = errors;
                        const _errs10 = errors;
                        if (errors === _errs10) {
                            if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                for (const key2 in data3) {
                                    let data4 = data3[key2];
                                    const _errs13 = errors;
                                    if (!(data4 && typeof data4 == "object" && !Array.isArray(data4))) {
                                        validate125.errors = [{ instancePath: instancePath + "/dotnet/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                        return false;
                                    }
                                    var valid4 = _errs13 === errors;
                                    if (!valid4) {
                                        break;
                                    }
                                }
                            }
                            else {
                                validate125.errors = [{ instancePath: instancePath + "/dotnet", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                return false;
                            }
                        }
                        var valid0 = _errs9 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.erlang !== undefined) {
                            let data5 = data.erlang;
                            const _errs15 = errors;
                            const _errs16 = errors;
                            if (errors === _errs16) {
                                if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
                                    for (const key3 in data5) {
                                        let data6 = data5[key3];
                                        const _errs19 = errors;
                                        if (!(data6 && typeof data6 == "object" && !Array.isArray(data6))) {
                                            validate125.errors = [{ instancePath: instancePath + "/erlang/" + key3.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                            return false;
                                        }
                                        var valid6 = _errs19 === errors;
                                        if (!valid6) {
                                            break;
                                        }
                                    }
                                }
                                else {
                                    validate125.errors = [{ instancePath: instancePath + "/erlang", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                    return false;
                                }
                            }
                            var valid0 = _errs15 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.go !== undefined) {
                                let data7 = data.go;
                                const _errs21 = errors;
                                const _errs22 = errors;
                                if (errors === _errs22) {
                                    if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
                                        for (const key4 in data7) {
                                            let data8 = data7[key4];
                                            const _errs25 = errors;
                                            if (!(data8 && typeof data8 == "object" && !Array.isArray(data8))) {
                                                validate125.errors = [{ instancePath: instancePath + "/go/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                return false;
                                            }
                                            var valid8 = _errs25 === errors;
                                            if (!valid8) {
                                                break;
                                            }
                                        }
                                    }
                                    else {
                                        validate125.errors = [{ instancePath: instancePath + "/go", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                        return false;
                                    }
                                }
                                var valid0 = _errs21 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.java !== undefined) {
                                    let data9 = data.java;
                                    const _errs27 = errors;
                                    const _errs28 = errors;
                                    if (errors === _errs28) {
                                        if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
                                            for (const key5 in data9) {
                                                let data10 = data9[key5];
                                                const _errs31 = errors;
                                                if (!(data10 && typeof data10 == "object" && !Array.isArray(data10))) {
                                                    validate125.errors = [{ instancePath: instancePath + "/java/" + key5.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                    return false;
                                                }
                                                var valid10 = _errs31 === errors;
                                                if (!valid10) {
                                                    break;
                                                }
                                            }
                                        }
                                        else {
                                            validate125.errors = [{ instancePath: instancePath + "/java", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                            return false;
                                        }
                                    }
                                    var valid0 = _errs27 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.js !== undefined) {
                                        let data11 = data.js;
                                        const _errs33 = errors;
                                        const _errs34 = errors;
                                        if (errors === _errs34) {
                                            if (data11 && typeof data11 == "object" && !Array.isArray(data11)) {
                                                for (const key6 in data11) {
                                                    let data12 = data11[key6];
                                                    const _errs37 = errors;
                                                    if (!(data12 && typeof data12 == "object" && !Array.isArray(data12))) {
                                                        validate125.errors = [{ instancePath: instancePath + "/js/" + key6.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                        return false;
                                                    }
                                                    var valid12 = _errs37 === errors;
                                                    if (!valid12) {
                                                        break;
                                                    }
                                                }
                                            }
                                            else {
                                                validate125.errors = [{ instancePath: instancePath + "/js", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                return false;
                                            }
                                        }
                                        var valid0 = _errs33 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                    if (valid0) {
                                        if (data.php !== undefined) {
                                            let data13 = data.php;
                                            const _errs39 = errors;
                                            const _errs40 = errors;
                                            if (errors === _errs40) {
                                                if (data13 && typeof data13 == "object" && !Array.isArray(data13)) {
                                                    for (const key7 in data13) {
                                                        let data14 = data13[key7];
                                                        const _errs43 = errors;
                                                        if (!(data14 && typeof data14 == "object" && !Array.isArray(data14))) {
                                                            validate125.errors = [{ instancePath: instancePath + "/php/" + key7.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                            return false;
                                                        }
                                                        var valid14 = _errs43 === errors;
                                                        if (!valid14) {
                                                            break;
                                                        }
                                                    }
                                                }
                                                else {
                                                    validate125.errors = [{ instancePath: instancePath + "/php", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                    return false;
                                                }
                                            }
                                            var valid0 = _errs39 === errors;
                                        }
                                        else {
                                            var valid0 = true;
                                        }
                                        if (valid0) {
                                            if (data.python !== undefined) {
                                                let data15 = data.python;
                                                const _errs45 = errors;
                                                const _errs46 = errors;
                                                if (errors === _errs46) {
                                                    if (data15 && typeof data15 == "object" && !Array.isArray(data15)) {
                                                        for (const key8 in data15) {
                                                            let data16 = data15[key8];
                                                            const _errs49 = errors;
                                                            if (!(data16 && typeof data16 == "object" && !Array.isArray(data16))) {
                                                                validate125.errors = [{ instancePath: instancePath + "/python/" + key8.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                return false;
                                                            }
                                                            var valid16 = _errs49 === errors;
                                                            if (!valid16) {
                                                                break;
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        validate125.errors = [{ instancePath: instancePath + "/python", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                        return false;
                                                    }
                                                }
                                                var valid0 = _errs45 === errors;
                                            }
                                            else {
                                                var valid0 = true;
                                            }
                                            if (valid0) {
                                                if (data.ruby !== undefined) {
                                                    let data17 = data.ruby;
                                                    const _errs51 = errors;
                                                    const _errs52 = errors;
                                                    if (errors === _errs52) {
                                                        if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
                                                            for (const key9 in data17) {
                                                                let data18 = data17[key9];
                                                                const _errs55 = errors;
                                                                if (!(data18 && typeof data18 == "object" && !Array.isArray(data18))) {
                                                                    validate125.errors = [{ instancePath: instancePath + "/ruby/" + key9.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                    return false;
                                                                }
                                                                var valid18 = _errs55 === errors;
                                                                if (!valid18) {
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                        else {
                                                            validate125.errors = [{ instancePath: instancePath + "/ruby", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                            return false;
                                                        }
                                                    }
                                                    var valid0 = _errs51 === errors;
                                                }
                                                else {
                                                    var valid0 = true;
                                                }
                                                if (valid0) {
                                                    if (data.rust !== undefined) {
                                                        let data19 = data.rust;
                                                        const _errs57 = errors;
                                                        const _errs58 = errors;
                                                        if (errors === _errs58) {
                                                            if (data19 && typeof data19 == "object" && !Array.isArray(data19)) {
                                                                for (const key10 in data19) {
                                                                    let data20 = data19[key10];
                                                                    const _errs61 = errors;
                                                                    if (!(data20 && typeof data20 == "object" && !Array.isArray(data20))) {
                                                                        validate125.errors = [{ instancePath: instancePath + "/rust/" + key10.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                        return false;
                                                                    }
                                                                    var valid20 = _errs61 === errors;
                                                                    if (!valid20) {
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                            else {
                                                                validate125.errors = [{ instancePath: instancePath + "/rust", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                return false;
                                                            }
                                                        }
                                                        var valid0 = _errs57 === errors;
                                                    }
                                                    else {
                                                        var valid0 = true;
                                                    }
                                                    if (valid0) {
                                                        if (data.swift !== undefined) {
                                                            let data21 = data.swift;
                                                            const _errs63 = errors;
                                                            const _errs64 = errors;
                                                            if (errors === _errs64) {
                                                                if (data21 && typeof data21 == "object" && !Array.isArray(data21)) {
                                                                    for (const key11 in data21) {
                                                                        let data22 = data21[key11];
                                                                        const _errs67 = errors;
                                                                        if (!(data22 && typeof data22 == "object" && !Array.isArray(data22))) {
                                                                            validate125.errors = [{ instancePath: instancePath + "/swift/" + key11.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                            return false;
                                                                        }
                                                                        var valid22 = _errs67 === errors;
                                                                        if (!valid22) {
                                                                            break;
                                                                        }
                                                                    }
                                                                }
                                                                else {
                                                                    validate125.errors = [{ instancePath: instancePath + "/swift", schemaPath: "#/$defs/ExperimentalLanguageSpecificInstrumentation/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                    return false;
                                                                }
                                                            }
                                                            var valid0 = _errs63 === errors;
                                                        }
                                                        else {
                                                            var valid0 = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate125.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate125.errors = vErrors; return errors === 0; }
validate125.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) { let vErrors = null; let errors = 0; const evaluated0 = validate20.evaluated; if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
} if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
} if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if ((data.file_format === undefined) && (missing0 = "file_format")) {
            validate20.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
            return false;
        }
        else {
            if (data.file_format !== undefined) {
                const _errs2 = errors;
                if (typeof data.file_format !== "string") {
                    validate20.errors = [{ instancePath: instancePath + "/file_format", schemaPath: "#/properties/file_format/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                }
                var valid0 = _errs2 === errors;
            }
            else {
                var valid0 = true;
            }
            if (valid0) {
                if (data.disabled !== undefined) {
                    let data1 = data.disabled;
                    const _errs4 = errors;
                    if ((typeof data1 !== "boolean") && (data1 !== null)) {
                        validate20.errors = [{ instancePath: instancePath + "/disabled", schemaPath: "#/properties/disabled/type", keyword: "type", params: { type: schema31.properties.disabled.type }, message: "must be boolean,null" }];
                        return false;
                    }
                    var valid0 = _errs4 === errors;
                }
                else {
                    var valid0 = true;
                }
                if (valid0) {
                    if (data.log_level !== undefined) {
                        let data2 = data.log_level;
                        const _errs6 = errors;
                        if ((typeof data2 !== "string") && (data2 !== null)) {
                            validate20.errors = [{ instancePath: instancePath + "/log_level", schemaPath: "#/$defs/SeverityNumber/type", keyword: "type", params: { type: schema32.type }, message: "must be string,null" }];
                            return false;
                        }
                        if (!((((((((((((((((((((((((data2 === "trace") || (data2 === "trace2")) || (data2 === "trace3")) || (data2 === "trace4")) || (data2 === "debug")) || (data2 === "debug2")) || (data2 === "debug3")) || (data2 === "debug4")) || (data2 === "info")) || (data2 === "info2")) || (data2 === "info3")) || (data2 === "info4")) || (data2 === "warn")) || (data2 === "warn2")) || (data2 === "warn3")) || (data2 === "warn4")) || (data2 === "error")) || (data2 === "error2")) || (data2 === "error3")) || (data2 === "error4")) || (data2 === "fatal")) || (data2 === "fatal2")) || (data2 === "fatal3")) || (data2 === "fatal4"))) {
                            validate20.errors = [{ instancePath: instancePath + "/log_level", schemaPath: "#/$defs/SeverityNumber/enum", keyword: "enum", params: { allowedValues: schema32.enum }, message: "must be equal to one of the allowed values" }];
                            return false;
                        }
                        var valid0 = _errs6 === errors;
                    }
                    else {
                        var valid0 = true;
                    }
                    if (valid0) {
                        if (data.attribute_limits !== undefined) {
                            let data3 = data.attribute_limits;
                            const _errs9 = errors;
                            const _errs10 = errors;
                            if (errors === _errs10) {
                                if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                    const _errs12 = errors;
                                    for (const key0 in data3) {
                                        if (!((key0 === "attribute_value_length_limit") || (key0 === "attribute_count_limit"))) {
                                            validate20.errors = [{ instancePath: instancePath + "/attribute_limits", schemaPath: "#/$defs/AttributeLimits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                                            return false;
                                            break;
                                        }
                                    }
                                    if (_errs12 === errors) {
                                        if (data3.attribute_value_length_limit !== undefined) {
                                            let data4 = data3.attribute_value_length_limit;
                                            const _errs13 = errors;
                                            if ((!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))) && (data4 !== null)) {
                                                validate20.errors = [{ instancePath: instancePath + "/attribute_limits/attribute_value_length_limit", schemaPath: "#/$defs/AttributeLimits/properties/attribute_value_length_limit/type", keyword: "type", params: { type: schema33.properties.attribute_value_length_limit.type }, message: "must be integer,null" }];
                                                return false;
                                            }
                                            if (errors === _errs13) {
                                                if (typeof data4 == "number") {
                                                    if (data4 < 0 || isNaN(data4)) {
                                                        validate20.errors = [{ instancePath: instancePath + "/attribute_limits/attribute_value_length_limit", schemaPath: "#/$defs/AttributeLimits/properties/attribute_value_length_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                        return false;
                                                    }
                                                }
                                            }
                                            var valid3 = _errs13 === errors;
                                        }
                                        else {
                                            var valid3 = true;
                                        }
                                        if (valid3) {
                                            if (data3.attribute_count_limit !== undefined) {
                                                let data5 = data3.attribute_count_limit;
                                                const _errs15 = errors;
                                                if ((!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))) && (data5 !== null)) {
                                                    validate20.errors = [{ instancePath: instancePath + "/attribute_limits/attribute_count_limit", schemaPath: "#/$defs/AttributeLimits/properties/attribute_count_limit/type", keyword: "type", params: { type: schema33.properties.attribute_count_limit.type }, message: "must be integer,null" }];
                                                    return false;
                                                }
                                                if (errors === _errs15) {
                                                    if (typeof data5 == "number") {
                                                        if (data5 < 0 || isNaN(data5)) {
                                                            validate20.errors = [{ instancePath: instancePath + "/attribute_limits/attribute_count_limit", schemaPath: "#/$defs/AttributeLimits/properties/attribute_count_limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                                            return false;
                                                        }
                                                    }
                                                }
                                                var valid3 = _errs15 === errors;
                                            }
                                            else {
                                                var valid3 = true;
                                            }
                                        }
                                    }
                                }
                                else {
                                    validate20.errors = [{ instancePath: instancePath + "/attribute_limits", schemaPath: "#/$defs/AttributeLimits/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                    return false;
                                }
                            }
                            var valid0 = _errs9 === errors;
                        }
                        else {
                            var valid0 = true;
                        }
                        if (valid0) {
                            if (data.logger_provider !== undefined) {
                                const _errs17 = errors;
                                if (!(validate21(data.logger_provider, { instancePath: instancePath + "/logger_provider", parentData: data, parentDataProperty: "logger_provider", rootData, dynamicAnchors }))) {
                                    vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
                                    errors = vErrors.length;
                                }
                                var valid0 = _errs17 === errors;
                            }
                            else {
                                var valid0 = true;
                            }
                            if (valid0) {
                                if (data.meter_provider !== undefined) {
                                    const _errs18 = errors;
                                    if (!(validate43(data.meter_provider, { instancePath: instancePath + "/meter_provider", parentData: data, parentDataProperty: "meter_provider", rootData, dynamicAnchors }))) {
                                        vErrors = vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
                                        errors = vErrors.length;
                                    }
                                    var valid0 = _errs18 === errors;
                                }
                                else {
                                    var valid0 = true;
                                }
                                if (valid0) {
                                    if (data.propagator !== undefined) {
                                        const _errs19 = errors;
                                        if (!(validate80(data.propagator, { instancePath: instancePath + "/propagator", parentData: data, parentDataProperty: "propagator", rootData, dynamicAnchors }))) {
                                            vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
                                            errors = vErrors.length;
                                        }
                                        var valid0 = _errs19 === errors;
                                    }
                                    else {
                                        var valid0 = true;
                                    }
                                    if (valid0) {
                                        if (data.tracer_provider !== undefined) {
                                            const _errs20 = errors;
                                            if (!(validate84(data.tracer_provider, { instancePath: instancePath + "/tracer_provider", parentData: data, parentDataProperty: "tracer_provider", rootData, dynamicAnchors }))) {
                                                vErrors = vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
                                                errors = vErrors.length;
                                            }
                                            var valid0 = _errs20 === errors;
                                        }
                                        else {
                                            var valid0 = true;
                                        }
                                        if (valid0) {
                                            if (data.resource !== undefined) {
                                                const _errs21 = errors;
                                                if (!(validate117(data.resource, { instancePath: instancePath + "/resource", parentData: data, parentDataProperty: "resource", rootData, dynamicAnchors }))) {
                                                    vErrors = vErrors === null ? validate117.errors : vErrors.concat(validate117.errors);
                                                    errors = vErrors.length;
                                                }
                                                var valid0 = _errs21 === errors;
                                            }
                                            else {
                                                var valid0 = true;
                                            }
                                            if (valid0) {
                                                if (data["instrumentation/development"] !== undefined) {
                                                    const _errs22 = errors;
                                                    if (!(validate125(data["instrumentation/development"], { instancePath: instancePath + "/instrumentation~1development", parentData: data, parentDataProperty: "instrumentation/development", rootData, dynamicAnchors }))) {
                                                        vErrors = vErrors === null ? validate125.errors : vErrors.concat(validate125.errors);
                                                        errors = vErrors.length;
                                                    }
                                                    var valid0 = _errs22 === errors;
                                                }
                                                else {
                                                    var valid0 = true;
                                                }
                                                if (valid0) {
                                                    if (data.distribution !== undefined) {
                                                        let data12 = data.distribution;
                                                        const _errs23 = errors;
                                                        const _errs24 = errors;
                                                        if (errors === _errs24) {
                                                            if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
                                                                if (Object.keys(data12).length < 1) {
                                                                    validate20.errors = [{ instancePath: instancePath + "/distribution", schemaPath: "#/$defs/Distribution/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                                                                    return false;
                                                                }
                                                                else {
                                                                    for (const key1 in data12) {
                                                                        let data13 = data12[key1];
                                                                        const _errs27 = errors;
                                                                        if (!(data13 && typeof data13 == "object" && !Array.isArray(data13))) {
                                                                            validate20.errors = [{ instancePath: instancePath + "/distribution/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/Distribution/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                            return false;
                                                                        }
                                                                        var valid5 = _errs27 === errors;
                                                                        if (!valid5) {
                                                                            break;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                            else {
                                                                validate20.errors = [{ instancePath: instancePath + "/distribution", schemaPath: "#/$defs/Distribution/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                                                return false;
                                                            }
                                                        }
                                                        var valid0 = _errs23 === errors;
                                                    }
                                                    else {
                                                        var valid0 = true;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        validate20.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
        return false;
    }
} validate20.errors = vErrors; return errors === 0; }
validate20.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
//# sourceMappingURL=validator.js.map