"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSamplerFromConfig = exports.getSamplerFromConfiguration = exports.getInstanceID = exports.getMeterViewsFromConfiguration = exports.getAggregationType = exports.getInstrumentType = exports.getMeterReadersFromConfiguration = exports.getIdGeneratorFromConfiguration = exports.getSpanProcessorsFromConfiguration = exports.getSpanExporter = exports.getGrpcMetadataFromHeaders = exports.getGrpcCredentialsFromTls = exports.getHttpAgentOptionsFromTls = exports.validateExporterTimeout = exports.getHeadersFromConfiguration = exports.getBatchLogRecordProcessorFromEnv = exports.getBatchLogRecordProcessorConfigFromEnv = exports.getLoggerProviderConfigFromEnv = exports.getPeriodicMetricReaderFromConfiguration = exports.getMetricExporter = exports.getOtlpMetricExporterFromEnv = exports.getPeriodicExportingMetricReaderFromEnv = exports.getNonNegativeNumberFromEnv = exports.getKeyListFromObjectArray = exports.setupPropagator = exports.setupContextManager = exports.getPropagatorFromConfiguration = exports.getPropagatorFromEnv = exports.getSpanProcessorsFromEnv = exports.getOtlpProtocolFromEnv = exports.getResourceDetectorsFromConfiguration = exports.getResourceDetectorsFromEnv = exports.getResourceFromConfiguration = void 0;
const api_1 = require("@opentelemetry/api");
const core_1 = require("@opentelemetry/core");
const exporter_trace_otlp_proto_1 = require("@opentelemetry/exporter-trace-otlp-proto");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const exporter_trace_otlp_grpc_1 = require("@opentelemetry/exporter-trace-otlp-grpc");
const exporter_zipkin_1 = require("@opentelemetry/exporter-zipkin");
const resources_1 = require("@opentelemetry/resources");
const sdk_trace_1 = require("@opentelemetry/sdk-trace");
const propagator_b3_1 = require("@opentelemetry/propagator-b3");
const propagator_jaeger_1 = require("@opentelemetry/propagator-jaeger");
const context_async_hooks_1 = require("@opentelemetry/context-async-hooks");
const otlp_exporter_base_1 = require("@opentelemetry/otlp-exporter-base");
const otlp_grpc_exporter_base_1 = require("@opentelemetry/otlp-grpc-exporter-base");
const configuration_1 = require("@opentelemetry/configuration");
const sdk_metrics_1 = require("@opentelemetry/sdk-metrics");
const exporter_metrics_otlp_grpc_1 = require("@opentelemetry/exporter-metrics-otlp-grpc");
const exporter_metrics_otlp_http_1 = require("@opentelemetry/exporter-metrics-otlp-http");
const exporter_metrics_otlp_http_2 = require("@opentelemetry/exporter-metrics-otlp-http");
const exporter_metrics_otlp_proto_1 = require("@opentelemetry/exporter-metrics-otlp-proto");
const sdk_logs_1 = require("@opentelemetry/sdk-logs");
const fs = require("fs");
const util_1 = require("util");
const create_from_env_1 = require("./create-from-env");
const RESOURCE_DETECTOR_ENVIRONMENT = 'env';
const RESOURCE_DETECTOR_HOST = 'host';
const RESOURCE_DETECTOR_OS = 'os';
const RESOURCE_DETECTOR_PROCESS = 'process';
const RESOURCE_DETECTOR_SERVICE_INSTANCE_ID = 'serviceinstance';
function getResourceFromConfiguration(config) {
    if (!config.resource) {
        return undefined;
    }
    const configAttrs = (0, configuration_1.mergeResourceAttributesConfig)(config.resource.attributes, config.resource.attributes_list);
    if (!configAttrs) {
        return undefined;
    }
    const attrs = {};
    for (let i = 0; i < configAttrs.length; i++) {
        const a = configAttrs[i];
        if (a.value !== null) {
            attrs[a.name] = a.value;
        }
    }
    return (0, resources_1.resourceFromAttributes)(attrs, {
        schemaUrl: config.resource.schema_url ?? undefined,
    });
}
exports.getResourceFromConfiguration = getResourceFromConfiguration;
function getResourceDetectorsFromEnv() {
    // When updating this list, make sure to also update the section `resourceDetectors` on README.
    const resourceDetectors = new Map([
        [RESOURCE_DETECTOR_HOST, resources_1.hostDetector],
        [RESOURCE_DETECTOR_OS, resources_1.osDetector],
        [RESOURCE_DETECTOR_SERVICE_INSTANCE_ID, resources_1.serviceInstanceIdDetector],
        [RESOURCE_DETECTOR_PROCESS, resources_1.processDetector],
        [RESOURCE_DETECTOR_ENVIRONMENT, resources_1.envDetector],
    ]);
    const resourceDetectorsFromEnv = (0, core_1.getStringListFromEnv)('OTEL_NODE_RESOURCE_DETECTORS') ?? ['all'];
    if (resourceDetectorsFromEnv.includes('all')) {
        return [...resourceDetectors.values()].flat();
    }
    if (resourceDetectorsFromEnv.includes('none')) {
        return [];
    }
    return resourceDetectorsFromEnv.flatMap(detector => {
        const resourceDetector = resourceDetectors.get(detector);
        if (!resourceDetector) {
            api_1.diag.warn(`Invalid resource detector "${detector}" specified in the environment variable OTEL_NODE_RESOURCE_DETECTORS`);
        }
        return resourceDetector || [];
    });
}
exports.getResourceDetectorsFromEnv = getResourceDetectorsFromEnv;
function getResourceDetectorsFromConfiguration(config) {
    const detectors = config.resource?.['detection/development']?.detectors ?? [];
    return detectors.flatMap(detector => {
        const result = [];
        if (detector.host !== undefined)
            result.push(resources_1.hostDetector);
        if (detector.os !== undefined)
            result.push(resources_1.osDetector);
        if (detector.process !== undefined)
            result.push(resources_1.processDetector);
        if (detector.service !== undefined)
            result.push(resources_1.serviceInstanceIdDetector);
        if (detector.env !== undefined)
            result.push(resources_1.envDetector);
        return result;
    });
}
exports.getResourceDetectorsFromConfiguration = getResourceDetectorsFromConfiguration;
function getOtlpProtocolFromEnv() {
    return ((0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL') ??
        (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_PROTOCOL') ??
        'http/protobuf');
}
exports.getOtlpProtocolFromEnv = getOtlpProtocolFromEnv;
function getOtlpExporterFromEnv() {
    const protocol = getOtlpProtocolFromEnv();
    switch (protocol) {
        case 'grpc':
            return new exporter_trace_otlp_grpc_1.OTLPTraceExporter();
        case 'http/json':
            return new exporter_trace_otlp_http_1.OTLPTraceExporter();
        case 'http/protobuf':
            return new exporter_trace_otlp_proto_1.OTLPTraceExporter();
        default:
            api_1.diag.warn(`Unsupported OTLP traces protocol: ${protocol}. Using http/protobuf.`);
            return new exporter_trace_otlp_proto_1.OTLPTraceExporter();
    }
}
function getSpanProcessorsFromEnv(selfObsMeterProvider) {
    const exportersMap = new Map([
        ['otlp', () => getOtlpExporterFromEnv()],
        ['zipkin', () => new exporter_zipkin_1.ZipkinExporter()],
        ['console', () => new sdk_trace_1.ConsoleSpanExporter()],
    ]);
    const exporters = [];
    const processors = [];
    let traceExportersList = Array.from(new Set((0, core_1.getStringListFromEnv)('OTEL_TRACES_EXPORTER'))).filter(s => s !== 'null');
    if (traceExportersList[0] === 'none') {
        api_1.diag.warn('OTEL_TRACES_EXPORTER contains "none". SDK will not be initialized.');
        return [];
    }
    if (traceExportersList.length === 0) {
        api_1.diag.debug('OTEL_TRACES_EXPORTER is empty. Using default otlp exporter.');
        traceExportersList = ['otlp'];
    }
    else if (traceExportersList.length > 1 &&
        traceExportersList.includes('none')) {
        api_1.diag.warn('OTEL_TRACES_EXPORTER contains "none" along with other exporters. Using default otlp exporter.');
        traceExportersList = ['otlp'];
    }
    for (const name of traceExportersList) {
        const exporter = exportersMap.get(name)?.();
        if (exporter) {
            exporters.push(exporter);
        }
        else {
            api_1.diag.warn(`Unrecognized OTEL_TRACES_EXPORTER value: ${name}.`);
        }
    }
    for (const exp of exporters) {
        if (exp instanceof sdk_trace_1.ConsoleSpanExporter) {
            processors.push(new sdk_trace_1.SimpleSpanProcessor({ exporter: exp, selfObsMeterProvider }));
        }
        else {
            processors.push((0, create_from_env_1.createBatchSpanProcessorFromEnv)(exp, selfObsMeterProvider));
        }
    }
    if (exporters.length === 0) {
        api_1.diag.warn('Unable to set up trace exporter(s) due to invalid exporter and/or protocol values.');
    }
    return processors;
}
exports.getSpanProcessorsFromEnv = getSpanProcessorsFromEnv;
/**
 * Get a propagator as defined by environment variables
 */
function getPropagatorFromEnv() {
    // Empty and undefined MUST be treated equal.
    const propagatorsEnvVarValue = (0, core_1.getStringListFromEnv)('OTEL_PROPAGATORS');
    if (propagatorsEnvVarValue == null) {
        // return undefined to fall back to default
        return undefined;
    }
    if (propagatorsEnvVarValue.includes('none')) {
        return null;
    }
    // Implementation note: this only contains specification required propagators that are actually hosted in this repo.
    // Any other propagators (like aws, aws-lambda, should go into `@opentelemetry/auto-configuration-propagators` instead).
    const propagatorsFactory = new Map([
        ['tracecontext', () => new core_1.W3CTraceContextPropagator()],
        ['baggage', () => new core_1.W3CBaggagePropagator()],
        ['b3', () => new propagator_b3_1.B3Propagator()],
        [
            'b3multi',
            () => new propagator_b3_1.B3Propagator({ injectEncoding: propagator_b3_1.B3InjectEncoding.MULTI_HEADER }),
        ],
        [
            'jaeger',
            () => {
                api_1.diag.warn('The Jaeger propagator is deprecated and will be removed in a future release. Use the W3C TraceContext propagator ("tracecontext") instead.');
                return new propagator_jaeger_1.JaegerPropagator();
            },
        ],
    ]);
    // Values MUST be deduplicated in order to register a Propagator only once.
    const uniquePropagatorNames = Array.from(new Set(propagatorsEnvVarValue));
    const validPropagators = [];
    uniquePropagatorNames.forEach(name => {
        const propagator = propagatorsFactory.get(name)?.();
        if (!propagator) {
            api_1.diag.warn(`Propagator "${name}" requested through environment variable is unavailable.`);
            return;
        }
        validPropagators.push(propagator);
    });
    if (validPropagators.length === 0) {
        // null to signal that the default should **not** be used in its place.
        return null;
    }
    else if (uniquePropagatorNames.length === 1) {
        return validPropagators[0];
    }
    else {
        return new core_1.CompositePropagator({
            propagators: validPropagators,
        });
    }
}
exports.getPropagatorFromEnv = getPropagatorFromEnv;
/**
 * Get a propagator as defined by configuration model from configuration
 */
function getPropagatorFromConfiguration(config) {
    if (!config.propagator) {
        return undefined;
    }
    const configComposite = (0, configuration_1.mergePropagatorCompositeConfig)(config.propagator.composite, config.propagator.composite_list);
    if (!configComposite) {
        return undefined;
    }
    // TextMapPropagator config items are objects with a single key (the name).
    // Transform this into a more convenient `(name, value)` 2-tuple.
    //
    // As well, guard against two cases where the TypeScript type
    // `TextMapPropagatorConfigModel` does not exactly represent the JSON schema:
    // 1. `"minProperties": 1, "maxProperties": 1,`
    // 2. The type allows keys with an `undefined` value, but the JSON schema
    //    does not.
    const kvFromItem = (item) => {
        const keys = [];
        let value = undefined;
        for (const key of Object.keys(item)) {
            value = item[key];
            if (value === undefined) {
                continue;
            }
            keys.push(key);
        }
        if (keys.length !== 1) {
            throw new Error(`invalid "propagator" entry in configuration, there must be exactly one key (with a non-undefined value): ${(0, util_1.inspect)(item)}`);
        }
        return [keys[0], value];
    };
    // First pass: handle 'none', remove dupes.
    const names = new Set();
    const kvs = [];
    for (const item of configComposite) {
        const kv = kvFromItem(item);
        const k = kv[0];
        if (names.has(k)) {
            continue;
        }
        names.add(k);
        kvs.push(kv);
        if (k === 'none') {
            return undefined;
        }
    }
    // Implementation note: this only contains specification required propagators that are actually hosted in this repo.
    // Any other propagators (like aws, aws-lambda, should go into `@opentelemetry/auto-configuration-propagators` instead).
    const propagatorsFactory = new Map([
        ['tracecontext', () => new core_1.W3CTraceContextPropagator()],
        ['baggage', () => new core_1.W3CBaggagePropagator()],
        ['b3', () => new propagator_b3_1.B3Propagator()],
        [
            'b3multi',
            () => new propagator_b3_1.B3Propagator({ injectEncoding: propagator_b3_1.B3InjectEncoding.MULTI_HEADER }),
        ],
        [
            'jaeger',
            () => {
                api_1.diag.warn('The Jaeger propagator is deprecated and will be removed in a future release. Use the W3C TraceContext propagator ("tracecontext") instead.');
                return new propagator_jaeger_1.JaegerPropagator();
            },
        ],
    ]);
    const validPropagators = [];
    for (const [name] of kvs) {
        const propagator = propagatorsFactory.get(name)?.();
        if (!propagator) {
            api_1.diag.warn(`Propagator "${name}" requested through configuration is unavailable.`);
            continue;
        }
        validPropagators.push(propagator);
    }
    if (validPropagators.length === 0) {
        return undefined;
    }
    else if (validPropagators.length === 1) {
        return validPropagators[0];
    }
    else {
        return new core_1.CompositePropagator({
            propagators: validPropagators,
        });
    }
}
exports.getPropagatorFromConfiguration = getPropagatorFromConfiguration;
function setupContextManager(contextManager) {
    // null means 'do not register'
    if (contextManager === null) {
        return;
    }
    // undefined means 'register default'
    if (contextManager === undefined) {
        const defaultContextManager = new context_async_hooks_1.AsyncLocalStorageContextManager();
        defaultContextManager.enable();
        api_1.context.setGlobalContextManager(defaultContextManager);
        return;
    }
    contextManager.enable();
    api_1.context.setGlobalContextManager(contextManager);
}
exports.setupContextManager = setupContextManager;
function setupPropagator(propagator) {
    // null means 'do not register'
    if (propagator === null) {
        return;
    }
    // undefined means 'register default'
    if (propagator === undefined) {
        api_1.propagation.setGlobalPropagator(new core_1.CompositePropagator({
            propagators: [
                new core_1.W3CTraceContextPropagator(),
                new core_1.W3CBaggagePropagator(),
            ],
        }));
        return;
    }
    api_1.propagation.setGlobalPropagator(propagator);
}
exports.setupPropagator = setupPropagator;
function getKeyListFromObjectArray(obj) {
    if (!obj || obj.length === 0) {
        return undefined;
    }
    const keys = [];
    for (const item of obj) {
        for (const key of Object.keys(item)) {
            keys.push(key);
        }
    }
    return keys;
}
exports.getKeyListFromObjectArray = getKeyListFromObjectArray;
function getNonNegativeNumberFromEnv(envVarName) {
    const value = (0, core_1.getNumberFromEnv)(envVarName);
    if (value != null && value <= 0) {
        api_1.diag.warn(`${envVarName} (${value}) is invalid, expected number greater than 0, using default.`);
        return undefined;
    }
    return value;
}
exports.getNonNegativeNumberFromEnv = getNonNegativeNumberFromEnv;
function getPeriodicExportingMetricReaderFromEnv(exporter) {
    const defaultTimeoutMillis = 30000;
    const defaultIntervalMillis = 60000;
    const rawExportIntervalMillis = getNonNegativeNumberFromEnv('OTEL_METRIC_EXPORT_INTERVAL');
    const rawExportTimeoutMillis = getNonNegativeNumberFromEnv('OTEL_METRIC_EXPORT_TIMEOUT');
    // Apply defaults
    const exportIntervalMillis = rawExportIntervalMillis ?? defaultIntervalMillis;
    let exportTimeoutMillis = rawExportTimeoutMillis ?? defaultTimeoutMillis;
    // Ensure timeout doesn't exceed interval
    if (exportTimeoutMillis > exportIntervalMillis) {
        // determine which env vars were set and which ones defaulted for logging purposes
        const timeoutSource = rawExportTimeoutMillis != null
            ? rawExportTimeoutMillis.toString()
            : `${defaultTimeoutMillis}, default`;
        const intervalSource = rawExportIntervalMillis != null
            ? rawExportIntervalMillis.toString()
            : `${defaultIntervalMillis}, default`;
        const bothSetByUser = rawExportTimeoutMillis != null && rawExportIntervalMillis != null;
        const logMessage = `OTEL_METRIC_EXPORT_TIMEOUT (${timeoutSource}) is greater than OTEL_METRIC_EXPORT_INTERVAL (${intervalSource}). Clamping timeout to interval value.`;
        // only bother users if they explicitly set both values.
        if (bothSetByUser) {
            api_1.diag.warn(logMessage);
        }
        else {
            api_1.diag.info(logMessage);
        }
        exportTimeoutMillis = exportIntervalMillis;
    }
    return new sdk_metrics_1.PeriodicExportingMetricReader({
        exportTimeoutMillis,
        exportIntervalMillis,
        exporter,
    });
}
exports.getPeriodicExportingMetricReaderFromEnv = getPeriodicExportingMetricReaderFromEnv;
function getOtlpMetricExporterFromEnv() {
    const protocol = ((0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_PROTOCOL') ??
        (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_PROTOCOL'))?.trim() || 'http/protobuf'; // Using || to also fall back on empty string
    switch (protocol) {
        case 'grpc':
            return new exporter_metrics_otlp_grpc_1.OTLPMetricExporter();
        case 'http/json':
            return new exporter_metrics_otlp_http_1.OTLPMetricExporter();
        case 'http/protobuf':
            return new exporter_metrics_otlp_proto_1.OTLPMetricExporter();
    }
    api_1.diag.warn(`Unsupported OTLP metrics protocol: "${protocol}". Using http/protobuf.`);
    return new exporter_metrics_otlp_proto_1.OTLPMetricExporter();
}
exports.getOtlpMetricExporterFromEnv = getOtlpMetricExporterFromEnv;
function getMetricProducersFromConfiguration(producers) {
    if (!producers || producers.length === 0) {
        return undefined;
    }
    const result = [];
    for (const producer of producers) {
        // Note: The "opencensus" MetricProducer is intentionally not supported.
        // It is deprecated in OpenTelemetry Configuration v1.2.0.
        api_1.diag.warn(`Unsupported metric producer in configuration: "${producer}". Skipping.`);
    }
    return result.length > 0 ? result : undefined;
}
/**
 * Map a declarative-config `temporality_preference` value to the enum the OTLP
 * metric exporters expect. Returns undefined for an unspecified preference so
 * the exporter falls back to its own default (cumulative).
 */
function getMetricTemporalityPreference(preference) {
    switch (preference) {
        case 'delta':
            return exporter_metrics_otlp_http_2.AggregationTemporalityPreference.DELTA;
        case 'low_memory':
            return exporter_metrics_otlp_http_2.AggregationTemporalityPreference.LOWMEMORY;
        case 'cumulative':
            return exporter_metrics_otlp_http_2.AggregationTemporalityPreference.CUMULATIVE;
        default:
            return undefined;
    }
}
/**
 * Map a declarative-config `default_histogram_aggregation` value to an
 * AggregationSelector that applies the requested aggregation to histogram
 * instruments and leaves all other instrument types at their default. Returns
 * undefined for an unspecified value so the exporter uses its own default.
 */
function getMetricAggregationPreference(aggregation) {
    let histogramAggregation;
    switch (aggregation) {
        case 'base2_exponential_bucket_histogram':
            histogramAggregation = { type: sdk_metrics_1.AggregationType.EXPONENTIAL_HISTOGRAM };
            break;
        case 'explicit_bucket_histogram':
            histogramAggregation = {
                type: sdk_metrics_1.AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            };
            break;
        default:
            return undefined;
    }
    return (instrumentType) => instrumentType === sdk_metrics_1.InstrumentType.HISTOGRAM
        ? histogramAggregation
        : { type: sdk_metrics_1.AggregationType.DEFAULT };
}
function getOtlpHttpMetricExporter(otlpHttp) {
    const encoding = otlpHttp?.encoding ?? 'protobuf';
    const options = {
        compression: otlpHttp?.compression === 'gzip'
            ? otlp_exporter_base_1.CompressionAlgorithm.GZIP
            : otlp_exporter_base_1.CompressionAlgorithm.NONE,
        url: otlpHttp?.endpoint ?? undefined,
        headers: getHeadersFromConfiguration(otlpHttp?.headers),
        timeoutMillis: validateExporterTimeout(otlpHttp?.timeout),
        httpAgentOptions: getHttpAgentOptionsFromTls(otlpHttp?.tls),
        temporalityPreference: getMetricTemporalityPreference(otlpHttp?.temporality_preference),
        aggregationPreference: getMetricAggregationPreference(otlpHttp?.default_histogram_aggregation),
    };
    if (encoding === 'json') {
        return new exporter_metrics_otlp_http_1.OTLPMetricExporter(options);
    }
    else if (encoding === 'protobuf') {
        return new exporter_metrics_otlp_proto_1.OTLPMetricExporter(options);
    }
    api_1.diag.warn(`Unsupported OTLP metrics encoding: ${encoding}.`);
    return undefined;
}
function getOtlpGrpcMetricExporter(otlpGrpc) {
    return new exporter_metrics_otlp_grpc_1.OTLPMetricExporter({
        compression: otlpGrpc?.compression === 'gzip'
            ? otlp_exporter_base_1.CompressionAlgorithm.GZIP
            : otlp_exporter_base_1.CompressionAlgorithm.NONE,
        url: otlpGrpc?.endpoint ?? undefined,
        timeoutMillis: validateExporterTimeout(otlpGrpc?.timeout),
        credentials: getGrpcCredentialsFromTls(otlpGrpc?.tls),
        metadata: getGrpcMetadataFromHeaders(otlpGrpc?.headers),
        temporalityPreference: getMetricTemporalityPreference(otlpGrpc?.temporality_preference),
        aggregationPreference: getMetricAggregationPreference(otlpGrpc?.default_histogram_aggregation),
    });
}
function getMetricExporter(exporter) {
    if (exporter.otlp_http !== undefined) {
        return getOtlpHttpMetricExporter(exporter.otlp_http);
    }
    if (exporter.otlp_grpc !== undefined) {
        return getOtlpGrpcMetricExporter(exporter.otlp_grpc);
    }
    if (exporter.console !== undefined) {
        return new sdk_metrics_1.ConsoleMetricExporter();
    }
    api_1.diag.warn('Unsupported Metric Exporter.');
    return undefined;
}
exports.getMetricExporter = getMetricExporter;
function getPeriodicMetricReaderFromConfiguration(periodic) {
    if (!periodic.exporter) {
        api_1.diag.warn('Unsupported Metric Exporter.');
        return undefined;
    }
    const exporter = getMetricExporter(periodic.exporter);
    if (!exporter) {
        return undefined;
    }
    const metricProducers = getMetricProducersFromConfiguration(periodic.producers);
    // TODO(6425): add cardinality_limits
    return new sdk_metrics_1.PeriodicExportingMetricReader({
        exportIntervalMillis: periodic.interval ?? 60000,
        exportTimeoutMillis: periodic.timeout ?? 30000,
        exporter,
        metricProducers,
    });
}
exports.getPeriodicMetricReaderFromConfiguration = getPeriodicMetricReaderFromConfiguration;
/**
 * Get LoggerProviderConfig from environment variables.
 */
function getLoggerProviderConfigFromEnv() {
    return {
        logRecordLimits: {
            attributeCountLimit: getNonNegativeNumberFromEnv('OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT') ??
                getNonNegativeNumberFromEnv('OTEL_ATTRIBUTE_COUNT_LIMIT'),
            attributeValueLengthLimit: getNonNegativeNumberFromEnv('OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT') ?? getNonNegativeNumberFromEnv('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT'),
        },
    };
}
exports.getLoggerProviderConfigFromEnv = getLoggerProviderConfigFromEnv;
/**
 * Get configuration for BatchLogRecordProcessor from environment variables.
 */
function getBatchLogRecordProcessorConfigFromEnv() {
    return {
        maxQueueSize: getNonNegativeNumberFromEnv('OTEL_BLRP_MAX_QUEUE_SIZE'),
        scheduledDelayMillis: getNonNegativeNumberFromEnv('OTEL_BLRP_SCHEDULE_DELAY'),
        exportTimeoutMillis: getNonNegativeNumberFromEnv('OTEL_BLRP_EXPORT_TIMEOUT'),
        maxExportBatchSize: getNonNegativeNumberFromEnv('OTEL_BLRP_MAX_EXPORT_BATCH_SIZE'),
    };
}
exports.getBatchLogRecordProcessorConfigFromEnv = getBatchLogRecordProcessorConfigFromEnv;
function getBatchLogRecordProcessorFromEnv(exporter, selfObsMeterProvider) {
    return new sdk_logs_1.BatchLogRecordProcessor({
        exporter,
        selfObsMeterProvider,
        ...getBatchLogRecordProcessorConfigFromEnv(),
    });
}
exports.getBatchLogRecordProcessorFromEnv = getBatchLogRecordProcessorFromEnv;
function getHeadersFromConfiguration(headers) {
    if (!headers) {
        return undefined;
    }
    const result = {};
    headers.forEach(header => {
        if (header.value !== null) {
            result[header.name] = header.value;
        }
    });
    return result;
}
exports.getHeadersFromConfiguration = getHeadersFromConfiguration;
/**
 * Validate an exporter timeout value. The spec says 0 means "no limit
 * (infinity)" but the JS exporters don't support that yet (see #6617).
 * Warn and return undefined so the exporter falls back to its default.
 */
function validateExporterTimeout(timeout) {
    if (timeout === null) {
        return undefined;
    }
    else if (timeout === 0) {
        api_1.diag.warn('Exporter timeout of 0 (infinite) is not supported. Using default timeout.');
        return undefined;
    }
    return timeout;
}
exports.validateExporterTimeout = validateExporterTimeout;
function getHttpAgentOptionsFromTls(tls) {
    if (tls && (tls.ca_file || tls.cert_file || tls.key_file)) {
        return {
            ca: readFileOrWarn(tls.ca_file, 'TLS CA'),
            cert: readFileOrWarn(tls.cert_file, 'TLS cert'),
            key: readFileOrWarn(tls.key_file, 'TLS key'),
        };
    }
    return undefined;
}
exports.getHttpAgentOptionsFromTls = getHttpAgentOptionsFromTls;
function getGrpcCredentialsFromTls(tls) {
    if (tls?.insecure) {
        return (0, otlp_grpc_exporter_base_1.createInsecureCredentials)();
    }
    const rootCert = readFileOrWarn(tls?.ca_file, 'TLS CA');
    const privateKey = readFileOrWarn(tls?.key_file, 'TLS key');
    const certChain = readFileOrWarn(tls?.cert_file, 'TLS cert');
    if (rootCert || privateKey || certChain) {
        try {
            return (0, otlp_grpc_exporter_base_1.createSslCredentials)(rootCert, privateKey, certChain);
        }
        catch (e) {
            api_1.diag.warn(`Failed to create gRPC SSL credentials: ${e}`);
            return undefined;
        }
    }
    return undefined;
}
exports.getGrpcCredentialsFromTls = getGrpcCredentialsFromTls;
function getGrpcMetadataFromHeaders(headers) {
    if (!headers || headers.length === 0) {
        return undefined;
    }
    const metadata = (0, otlp_grpc_exporter_base_1.createEmptyMetadata)();
    for (const header of headers) {
        if (header.value !== null) {
            metadata.set(header.name, header.value);
        }
    }
    return metadata;
}
exports.getGrpcMetadataFromHeaders = getGrpcMetadataFromHeaders;
function readFileOrWarn(filePath, label) {
    if (!filePath)
        return undefined;
    try {
        return fs.readFileSync(filePath);
    }
    catch (e) {
        api_1.diag.warn(`Failed to read ${label} file at ${filePath}: ${e}`);
        return undefined;
    }
}
function getSpanExporter(exporter) {
    if (exporter.otlp_http !== undefined) {
        const encoding = exporter.otlp_http?.encoding ?? 'protobuf';
        if (encoding === 'json') {
            return new exporter_trace_otlp_http_1.OTLPTraceExporter({
                compression: exporter.otlp_http?.compression === 'gzip'
                    ? otlp_exporter_base_1.CompressionAlgorithm.GZIP
                    : otlp_exporter_base_1.CompressionAlgorithm.NONE,
                url: exporter.otlp_http?.endpoint ?? undefined,
                headers: getHeadersFromConfiguration(exporter.otlp_http?.headers),
                timeoutMillis: validateExporterTimeout(exporter.otlp_http?.timeout),
                httpAgentOptions: getHttpAgentOptionsFromTls(exporter.otlp_http?.tls),
            });
        }
        else {
            return new exporter_trace_otlp_proto_1.OTLPTraceExporter({
                compression: exporter.otlp_http?.compression === 'gzip'
                    ? otlp_exporter_base_1.CompressionAlgorithm.GZIP
                    : otlp_exporter_base_1.CompressionAlgorithm.NONE,
                url: exporter.otlp_http?.endpoint ?? undefined,
                headers: getHeadersFromConfiguration(exporter.otlp_http?.headers),
                timeoutMillis: validateExporterTimeout(exporter.otlp_http?.timeout),
                httpAgentOptions: getHttpAgentOptionsFromTls(exporter.otlp_http?.tls),
            });
        }
    }
    else if (exporter.otlp_grpc !== undefined) {
        return new exporter_trace_otlp_grpc_1.OTLPTraceExporter({
            compression: exporter.otlp_grpc?.compression === 'gzip'
                ? otlp_exporter_base_1.CompressionAlgorithm.GZIP
                : otlp_exporter_base_1.CompressionAlgorithm.NONE,
            url: exporter.otlp_grpc?.endpoint ?? undefined,
            timeoutMillis: validateExporterTimeout(exporter.otlp_grpc?.timeout),
            credentials: getGrpcCredentialsFromTls(exporter.otlp_grpc?.tls),
            metadata: getGrpcMetadataFromHeaders(exporter.otlp_grpc?.headers),
        });
    }
    else if (exporter.console !== undefined) {
        return new sdk_trace_1.ConsoleSpanExporter();
    }
    api_1.diag.warn('Unsupported Exporter value. No Span Exporter registered');
    return undefined;
}
exports.getSpanExporter = getSpanExporter;
function getSpanProcessorsFromConfiguration(config) {
    const spanProcessors = [];
    config.tracer_provider?.processors?.forEach(processor => {
        if (processor.batch) {
            const exporter = getSpanExporter(processor.batch.exporter);
            if (exporter) {
                spanProcessors.push(new sdk_trace_1.BatchSpanProcessor({
                    exporter,
                    maxQueueSize: processor.batch.max_queue_size ?? undefined,
                    maxExportBatchSize: processor.batch.max_export_batch_size ?? undefined,
                    scheduledDelayMillis: processor.batch.schedule_delay ?? undefined,
                    exportTimeoutMillis: processor.batch.export_timeout ?? undefined,
                }));
            }
        }
        if (processor.simple) {
            const exporter = getSpanExporter(processor.simple.exporter);
            if (exporter) {
                spanProcessors.push(new sdk_trace_1.SimpleSpanProcessor({ exporter }));
            }
        }
    });
    if (spanProcessors.length > 0) {
        return spanProcessors;
    }
    return undefined;
}
exports.getSpanProcessorsFromConfiguration = getSpanProcessorsFromConfiguration;
function getIdGeneratorFromConfiguration(config) {
    const idGenerator = config.tracer_provider?.id_generator;
    if (!idGenerator) {
        return undefined;
    }
    if (idGenerator.random !== undefined) {
        return new sdk_trace_1.RandomIdGenerator();
    }
    // Any other key is a third-party / custom id_generator type which we
    // don't currently support. Warn and fall back to SDK default.
    const unknownKeys = Object.keys(idGenerator).filter(k => k !== 'random');
    if (unknownKeys.length > 0) {
        api_1.diag.warn(`Unsupported id_generator type(s): ${unknownKeys.join(', ')}. Using default.`);
    }
    return undefined;
}
exports.getIdGeneratorFromConfiguration = getIdGeneratorFromConfiguration;
function getMeterReadersFromConfiguration(config) {
    const metricReaders = [];
    config.meter_provider?.readers?.forEach(reader => {
        if (reader.periodic) {
            const periodicReader = getPeriodicMetricReaderFromConfiguration(reader.periodic);
            if (periodicReader) {
                metricReaders.push(periodicReader);
            }
        }
    });
    if (metricReaders.length > 0) {
        return metricReaders;
    }
    return undefined;
}
exports.getMeterReadersFromConfiguration = getMeterReadersFromConfiguration;
function getInstrumentType(instrument) {
    switch (instrument) {
        case 'counter':
            return sdk_metrics_1.InstrumentType.COUNTER;
        case 'gauge':
            return sdk_metrics_1.InstrumentType.GAUGE;
        case 'histogram':
            return sdk_metrics_1.InstrumentType.HISTOGRAM;
        case 'observable_counter':
            return sdk_metrics_1.InstrumentType.OBSERVABLE_COUNTER;
        case 'observable_gauge':
            return sdk_metrics_1.InstrumentType.OBSERVABLE_GAUGE;
        case 'observable_up_down_counter':
            return sdk_metrics_1.InstrumentType.OBSERVABLE_UP_DOWN_COUNTER;
        case 'up_down_counter':
            return sdk_metrics_1.InstrumentType.UP_DOWN_COUNTER;
        default:
            api_1.diag.warn(`Unsupported instrument type: ${instrument}`);
            return undefined;
    }
}
exports.getInstrumentType = getInstrumentType;
function getAggregationType(aggregation) {
    if (aggregation.default) {
        return {
            type: sdk_metrics_1.AggregationType.DEFAULT,
        };
    }
    if (aggregation.drop) {
        return {
            type: sdk_metrics_1.AggregationType.DROP,
        };
    }
    if (aggregation.explicit_bucket_histogram) {
        return {
            type: sdk_metrics_1.AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: {
                recordMinMax: aggregation.explicit_bucket_histogram.record_min_max ?? true,
                boundaries: aggregation.explicit_bucket_histogram.boundaries ?? [
                    0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500,
                    10000,
                ],
            },
        };
    }
    if (aggregation.base2_exponential_bucket_histogram) {
        return {
            type: sdk_metrics_1.AggregationType.EXPONENTIAL_HISTOGRAM,
            options: {
                recordMinMax: aggregation.base2_exponential_bucket_histogram.record_min_max ??
                    undefined,
                maxSize: aggregation.base2_exponential_bucket_histogram.max_size ?? undefined,
            },
        };
    }
    if (aggregation.last_value) {
        return {
            type: sdk_metrics_1.AggregationType.LAST_VALUE,
        };
    }
    if (aggregation.sum) {
        return {
            type: sdk_metrics_1.AggregationType.SUM,
        };
    }
    api_1.diag.warn('Unsupported aggregation type');
    return undefined;
}
exports.getAggregationType = getAggregationType;
function getMeterViewsFromConfiguration(config) {
    const metricViews = [];
    config.meter_provider?.views?.forEach(view => {
        const viewOption = {};
        if (view.selector) {
            if (view.selector.instrument_name) {
                viewOption.instrumentName = view.selector.instrument_name;
            }
            if (view.selector.instrument_type) {
                const instrumentType = getInstrumentType(view.selector.instrument_type);
                if (instrumentType) {
                    viewOption.instrumentType = instrumentType;
                }
            }
            if (view.selector.unit) {
                viewOption.instrumentUnit = view.selector.unit;
            }
            if (view.selector.meter_name) {
                viewOption.meterName = view.selector.meter_name;
            }
            if (view.selector.meter_version) {
                viewOption.meterVersion = view.selector.meter_version;
            }
            if (view.selector.meter_schema_url) {
                viewOption.meterSchemaUrl = view.selector.meter_schema_url;
            }
        }
        if (view.stream) {
            if (view.stream.name) {
                viewOption.name = view.stream.name;
            }
            viewOption.aggregationCardinalityLimit =
                view.stream.aggregation_cardinality_limit ?? 2000;
            if (view.stream.description) {
                viewOption.description = view.stream.description;
            }
            if (view.stream.aggregation) {
                const aggregationType = getAggregationType(view.stream.aggregation);
                if (aggregationType) {
                    viewOption.aggregation = aggregationType;
                }
            }
            if (view.stream.attribute_keys) {
                const processors = [];
                if (view.stream.attribute_keys.included &&
                    view.stream.attribute_keys.included.length > 0) {
                    processors.push((0, sdk_metrics_1.createAllowListAttributesProcessor)(view.stream.attribute_keys.included));
                }
                if (view.stream.attribute_keys.excluded &&
                    view.stream.attribute_keys.excluded.length > 0) {
                    processors.push((0, sdk_metrics_1.createDenyListAttributesProcessor)(view.stream.attribute_keys.excluded));
                }
                if (processors.length > 0) {
                    viewOption.attributesProcessors = processors;
                }
            }
        }
        if (Object.keys(viewOption).length > 0) {
            metricViews.push(viewOption);
        }
    });
    if (metricViews.length > 0) {
        return metricViews;
    }
    return undefined;
}
exports.getMeterViewsFromConfiguration = getMeterViewsFromConfiguration;
function getInstanceID(config) {
    if (config.resource?.attributes) {
        for (let i = 0; i < config.resource.attributes.length; i++) {
            const element = config.resource.attributes[i];
            if (element.name === 'service.instance.id') {
                return element.value?.toString();
            }
        }
    }
    return undefined;
}
exports.getInstanceID = getInstanceID;
const DEFAULT_RATIO = 1;
/**
 * Returns the {@link Sampler} configured under `tracer_provider.sampler` in
 * the declarative configuration, or `undefined` if none is set (in which case
 * the SDK applies its default sampler).
 */
function getSamplerFromConfiguration(config) {
    const samplerConfig = config.tracer_provider?.sampler;
    if (!samplerConfig) {
        return undefined;
    }
    return buildSamplerFromConfig(samplerConfig);
}
exports.getSamplerFromConfiguration = getSamplerFromConfiguration;
/**
 * Builds a {@link Sampler} from a {@link SamplerConfigModel} data model.
 * This allows sampler construction from declarative configuration.
 */
function buildSamplerFromConfig(samplerConfig) {
    if (samplerConfig.always_on !== undefined) {
        return new sdk_trace_1.AlwaysOnSampler();
    }
    if (samplerConfig.always_off !== undefined) {
        return new sdk_trace_1.AlwaysOffSampler();
    }
    if (samplerConfig.trace_id_ratio_based !== undefined) {
        return new sdk_trace_1.TraceIdRatioBasedSampler(samplerConfig.trace_id_ratio_based?.ratio ?? DEFAULT_RATIO);
    }
    if (samplerConfig.parent_based !== undefined) {
        const pb = samplerConfig.parent_based ?? {};
        return new sdk_trace_1.ParentBasedSampler({
            root: pb.root ? buildSamplerFromConfig(pb.root) : new sdk_trace_1.AlwaysOnSampler(),
            remoteParentSampled: pb.remote_parent_sampled
                ? buildSamplerFromConfig(pb.remote_parent_sampled)
                : undefined,
            remoteParentNotSampled: pb.remote_parent_not_sampled
                ? buildSamplerFromConfig(pb.remote_parent_not_sampled)
                : undefined,
            localParentSampled: pb.local_parent_sampled
                ? buildSamplerFromConfig(pb.local_parent_sampled)
                : undefined,
            localParentNotSampled: pb.local_parent_not_sampled
                ? buildSamplerFromConfig(pb.local_parent_not_sampled)
                : undefined,
        });
    }
    api_1.diag.warn('Unknown sampler config, defaulting to ParentBased(AlwaysOn).');
    return new sdk_trace_1.ParentBasedSampler({ root: new sdk_trace_1.AlwaysOnSampler() });
}
exports.buildSamplerFromConfig = buildSamplerFromConfig;
//# sourceMappingURL=utils.js.map