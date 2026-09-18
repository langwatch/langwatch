"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLoggerProvider = exports.setMeterProvider = exports.setTracerProvider = exports.setSampler = exports.setPropagators = exports.setAttributeLimits = exports.setResources = exports.EnvironmentConfigFactory = void 0;
const core_1 = require("@opentelemetry/core");
const api_1 = require("@opentelemetry/api");
const utils_1 = require("./utils");
const EnvReader_1 = require("./EnvReader");
const EnvDefinition_1 = require("./EnvDefinition");
/**
 * EnvironmentConfigProvider provides a configuration based on environment variables.
 */
class EnvironmentConfigFactory {
    _config;
    constructor() {
        this._config = (0, utils_1.initializeDefaultConfiguration)();
        const envValues = (0, EnvReader_1.readAllEnvVars)();
        this._config.disabled = envValues.OTEL_SDK_DISABLED;
        const logLevelString = (0, core_1.getStringFromEnv)('OTEL_LOG_LEVEL');
        if (logLevelString) {
            this._config.log_level =
                severityNumberConfigFromLogLevelString(logLevelString);
        }
        setResources(this._config);
        setAttributeLimits(this._config);
        setPropagators(this._config);
        setTracerProvider(this._config, envValues);
        setMeterProvider(this._config);
        setLoggerProvider(this._config);
    }
    getConfigModel() {
        return this._config;
    }
}
exports.EnvironmentConfigFactory = EnvironmentConfigFactory;
const SEV_NUM_CONFIG_FROM_LOG_LEVEL = {
    // Declarative config `log_level` has no "NONE". Using 'fatal' is
    // equivalent, because the OTel JS diag API does not have a "fatal" level.
    NONE: 'fatal',
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    VERBOSE: 'trace2',
    // Declarative config `log_level` has no "ALL". Using 'trace' is
    // equivalent, because that is the lowest SeverityNumber level.
    ALL: 'trace',
};
/**
 * Return a declarative config SeverityNumberConfig value (as used for
 * `log_level`) for the given `OTEL_LOG_LEVEL` string value.
 *
 * See notes at "opentelemetr-sdk-node/src/diag.ts".
 */
function severityNumberConfigFromLogLevelString(str) {
    if (!str) {
        return undefined;
    }
    const sevNumConfig = SEV_NUM_CONFIG_FROM_LOG_LEVEL[str.toUpperCase()];
    if (!sevNumConfig) {
        api_1.diag.warn(`Unknown log level "${str}", expected one of ${Object.keys(SEV_NUM_CONFIG_FROM_LOG_LEVEL)}, using default info`);
        return 'info';
    }
    return sevNumConfig;
}
function setResources(config) {
    if (config.resource == null) {
        config.resource = {};
    }
    const resourceAttrList = (0, core_1.getStringFromEnv)('OTEL_RESOURCE_ATTRIBUTES');
    const list = resourceAttrList
        ? resourceAttrList
            .split(',')
            .map(s => s.trim())
            .filter(s => s)
        : [];
    const serviceName = (0, core_1.getStringFromEnv)('OTEL_SERVICE_NAME');
    if (serviceName) {
        config.resource.attributes = [
            {
                name: 'service.name',
                value: serviceName,
                type: 'string',
            },
        ];
    }
    if (list.length > 0) {
        config.resource.attributes_list = resourceAttrList;
        if (config.resource.attributes == null) {
            config.resource.attributes = [];
        }
        for (let i = 0; i < list.length; i++) {
            const element = list[i].split('=');
            if (element[0] !== 'service.name' ||
                (element[0] === 'service.name' && serviceName === undefined)) {
                config.resource.attributes.push({
                    name: element[0],
                    value: element[1],
                    type: 'string',
                });
            }
        }
    }
    const nodeDetectors = (0, core_1.getStringListFromEnv)('OTEL_NODE_RESOURCE_DETECTORS');
    if (nodeDetectors &&
        nodeDetectors.length > 0 &&
        !nodeDetectors.includes('none')) {
        const all = nodeDetectors.includes('all');
        const detectors = [];
        if (all || nodeDetectors.includes('container'))
            detectors.push({ container: {} });
        if (all || nodeDetectors.includes('host'))
            detectors.push({ host: {} });
        if (all || nodeDetectors.includes('os'))
            detectors.push({ os: {} });
        if (all || nodeDetectors.includes('process'))
            detectors.push({ process: {} });
        if (all || nodeDetectors.includes('serviceinstance'))
            detectors.push({ service: {} });
        if (all || nodeDetectors.includes('env'))
            detectors.push({ env: {} });
        if (detectors.length > 0) {
            if (config.resource['detection/development'] == null) {
                config.resource['detection/development'] = {};
            }
            config.resource['detection/development'].detectors = detectors;
        }
    }
}
exports.setResources = setResources;
function setAttributeLimits(config) {
    const attributeValueLengthLimit = (0, core_1.getNumberFromEnv)('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT');
    if (attributeValueLengthLimit && attributeValueLengthLimit > 0) {
        if (config.attribute_limits == null) {
            config.attribute_limits = { attribute_count_limit: 128 };
        }
        config.attribute_limits.attribute_value_length_limit =
            attributeValueLengthLimit;
    }
    const attributeCountLimit = (0, core_1.getNumberFromEnv)('OTEL_ATTRIBUTE_COUNT_LIMIT');
    if (attributeCountLimit) {
        if (config.attribute_limits == null) {
            config.attribute_limits = { attribute_count_limit: attributeCountLimit };
        }
        else {
            config.attribute_limits.attribute_count_limit = attributeCountLimit;
        }
    }
}
exports.setAttributeLimits = setAttributeLimits;
function setPropagators(config) {
    if (config.propagator == null) {
        config.propagator = {};
    }
    const compositeList = (0, core_1.getStringFromEnv)('OTEL_PROPAGATORS');
    if (compositeList) {
        config.propagator.composite_list = compositeList;
        const names = compositeList
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
        if (names.length > 0) {
            config.propagator.composite = [];
            // Store each propagator name as a type-discriminator key. The config
            // model doesn't validate names here — known vs third-party propagators
            // are resolved when the SDK instantiates from the model.
            for (const name of names) {
                config.propagator.composite.push({ [name]: {} });
            }
        }
    }
}
exports.setPropagators = setPropagators;
function setSampler(config, env) {
    const sampler = env.OTEL_TRACES_SAMPLER;
    const arg = env.OTEL_TRACES_SAMPLER_ARG;
    if (!sampler || !config.tracer_provider) {
        return;
    }
    const ratio = arg ? parseFloat(arg) : 1.0;
    switch (sampler) {
        case EnvDefinition_1.SamplerType.AlwaysOn:
            config.tracer_provider.sampler = { always_on: {} };
            break;
        case EnvDefinition_1.SamplerType.AlwaysOff:
            config.tracer_provider.sampler = { always_off: {} };
            break;
        case EnvDefinition_1.SamplerType.TraceIdRatio:
            config.tracer_provider.sampler = {
                trace_id_ratio_based: { ratio },
            };
            break;
        case EnvDefinition_1.SamplerType.ParentBasedAlwaysOn:
            config.tracer_provider.sampler = {
                parent_based: { root: { always_on: {} } },
            };
            break;
        case EnvDefinition_1.SamplerType.ParentBasedAlwaysOff:
            config.tracer_provider.sampler = {
                parent_based: { root: { always_off: {} } },
            };
            break;
        case EnvDefinition_1.SamplerType.ParentBasedTraceIdRatio:
            config.tracer_provider.sampler = {
                parent_based: { root: { trace_id_ratio_based: { ratio } } },
            };
            break;
        default:
            // readEnvVar already warns for invalid values via allowedValues
            break;
    }
}
exports.setSampler = setSampler;
function setTracerProvider(config, env) {
    const exportersType = Array.from(new Set((0, core_1.getStringListFromEnv)('OTEL_TRACES_EXPORTER')));
    if (exportersType.length === 0) {
        return;
    }
    if (exportersType.includes('none')) {
        api_1.diag.info('OTEL_TRACES_EXPORTER contains "none". Tracer provider will not be initialized.');
        return;
    }
    config.tracer_provider = (0, utils_1.initializeDefaultTracerProviderConfiguration)();
    setSampler(config, env);
    const attributeValueLengthLimit = (0, core_1.getNumberFromEnv)('OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT');
    if (attributeValueLengthLimit) {
        config.tracer_provider.limits.attribute_value_length_limit =
            attributeValueLengthLimit;
    }
    const attributeCountLimit = (0, core_1.getNumberFromEnv)('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT');
    if (attributeCountLimit) {
        config.tracer_provider.limits.attribute_count_limit = attributeCountLimit;
    }
    const eventCountLimit = (0, core_1.getNumberFromEnv)('OTEL_SPAN_EVENT_COUNT_LIMIT');
    if (eventCountLimit) {
        config.tracer_provider.limits.event_count_limit = eventCountLimit;
    }
    const linkCountLimit = (0, core_1.getNumberFromEnv)('OTEL_SPAN_LINK_COUNT_LIMIT');
    if (linkCountLimit) {
        config.tracer_provider.limits.link_count_limit = linkCountLimit;
    }
    const eventAttributeCountLimit = (0, core_1.getNumberFromEnv)('OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT');
    if (eventAttributeCountLimit) {
        config.tracer_provider.limits.event_attribute_count_limit =
            eventAttributeCountLimit;
    }
    const linkAttributeCountLimit = (0, core_1.getNumberFromEnv)('OTEL_LINK_ATTRIBUTE_COUNT_LIMIT');
    if (linkAttributeCountLimit) {
        config.tracer_provider.limits.link_attribute_count_limit =
            linkAttributeCountLimit;
    }
    const batch = {
        exporter: {},
        schedule_delay: (0, core_1.getNumberFromEnv)('OTEL_BSP_SCHEDULE_DELAY') ?? 5000,
        export_timeout: (0, core_1.getNumberFromEnv)('OTEL_BSP_EXPORT_TIMEOUT') ?? 30000,
        max_queue_size: (0, core_1.getNumberFromEnv)('OTEL_BSP_MAX_QUEUE_SIZE') ?? 2048,
        max_export_batch_size: (0, core_1.getNumberFromEnv)('OTEL_BSP_MAX_EXPORT_BATCH_SIZE') ?? 512,
    };
    for (let i = 0; i < exportersType.length; i++) {
        const exporterType = exportersType[i];
        const batchInfo = {
            ...batch,
            exporter: {},
        };
        if (exporterType === 'console') {
            const processor = {
                simple: { exporter: { console: {} } },
            };
            config.tracer_provider.processors.push(processor);
        }
        else {
            const protocol = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_PROTOCOL') ??
                'http/protobuf';
            const certificateFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CERTIFICATE');
            const clientKeyFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CLIENT_KEY');
            const clientCertificateFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE');
            const compression = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_COMPRESSION') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_COMPRESSION');
            const timeout = (0, core_1.getNumberFromEnv)('OTEL_EXPORTER_OTLP_TRACES_TIMEOUT') ??
                (0, core_1.getNumberFromEnv)('OTEL_EXPORTER_OTLP_TIMEOUT') ??
                10000;
            const headersList = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_HEADERS') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_HEADERS');
            if (protocol === 'grpc') {
                const tls = (0, utils_1.getGrpcTlsConfig)(certificateFile, clientKeyFile, clientCertificateFile);
                const otlpGrpc = {
                    endpoint: (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT') ??
                        (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT') ??
                        'http://localhost:4317',
                    timeout,
                    ...(tls !== undefined && { tls }),
                    ...(compression !== undefined && { compression }),
                    ...(headersList !== undefined && { headers_list: headersList }),
                };
                batchInfo.exporter = { otlp_grpc: otlpGrpc };
            }
            else {
                const tls = (0, utils_1.getHttpTlsConfig)(certificateFile, clientKeyFile, clientCertificateFile);
                const encoding = protocol === 'http/json'
                    ? 'json'
                    : protocol === 'http/protobuf'
                        ? 'protobuf'
                        : undefined;
                const otlpHttp = {
                    endpoint: (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT') ??
                        ((0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT')
                            ? `${(0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT')}/v1/traces`
                            : 'http://localhost:4318/v1/traces'),
                    timeout,
                    ...(tls !== undefined && { tls }),
                    ...(compression !== undefined && { compression }),
                    ...(headersList !== undefined && { headers_list: headersList }),
                    ...(encoding !== undefined && { encoding }),
                };
                batchInfo.exporter = { otlp_http: otlpHttp };
            }
            const processor = { batch: batchInfo };
            config.tracer_provider.processors.push(processor);
        }
    }
}
exports.setTracerProvider = setTracerProvider;
function setMeterProvider(config) {
    const exportersType = Array.from(new Set((0, core_1.getStringListFromEnv)('OTEL_METRICS_EXPORTER')));
    if (exportersType.length === 0) {
        return;
    }
    if (exportersType.includes('none')) {
        api_1.diag.info('OTEL_METRICS_EXPORTER contains "none". Meter provider will not be initialized.');
        return;
    }
    config.meter_provider = (0, utils_1.initializeDefaultMeterProviderConfiguration)();
    const interval = (0, core_1.getNumberFromEnv)('OTEL_METRIC_EXPORT_INTERVAL') ?? 60000;
    for (let i = 0; i < exportersType.length; i++) {
        const exporterType = exportersType[i];
        if (exporterType === 'prometheus') {
            const pullReader = {
                exporter: {
                    'prometheus/development': {
                        host: (0, core_1.getStringFromEnv)('OTEL_EXPORTER_PROMETHEUS_HOST') ?? 'localhost',
                        port: (0, core_1.getNumberFromEnv)('OTEL_EXPORTER_PROMETHEUS_PORT') ?? 9464,
                        scope_info_enabled: true,
                        'target_info_enabled/development': true,
                    },
                },
            };
            config.meter_provider.readers.push({ pull: pullReader });
            continue;
        }
        const readerPeriodicInfo = {
            interval,
            timeout: (0, core_1.getNumberFromEnv)('OTEL_METRIC_EXPORT_TIMEOUT') ?? 30000,
            exporter: {},
        };
        if (exporterType === 'console') {
            readerPeriodicInfo.exporter = { console: {} };
        }
        else {
            const protocol = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_PROTOCOL') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_PROTOCOL') ??
                'http/protobuf';
            const certificateFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CERTIFICATE');
            const clientKeyFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CLIENT_KEY');
            const clientCertificateFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE');
            const compression = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_COMPRESSION') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_COMPRESSION');
            const timeoutExporter = (0, core_1.getNumberFromEnv)('OTEL_EXPORTER_OTLP_METRICS_TIMEOUT') ??
                (0, core_1.getNumberFromEnv)('OTEL_EXPORTER_OTLP_TIMEOUT') ??
                10000;
            const headersList = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_HEADERS') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_HEADERS');
            const rawTemporality = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE') ??
                'cumulative';
            const validTemporalities = ['cumulative', 'delta', 'low_memory'];
            const temporalityPreference = validTemporalities.includes(rawTemporality)
                ? rawTemporality
                : 'cumulative';
            const rawHistogramAgg = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION') ?? 'explicit_bucket_histogram';
            const validHistogramAggs = [
                'explicit_bucket_histogram',
                'base2_exponential_bucket_histogram',
            ];
            const defaultHistogramAggregation = validHistogramAggs.includes(rawHistogramAgg)
                ? rawHistogramAgg
                : 'explicit_bucket_histogram';
            if (protocol === 'grpc') {
                const tls = (0, utils_1.getGrpcTlsConfig)(certificateFile, clientKeyFile, clientCertificateFile);
                const otlpGrpc = {
                    endpoint: (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT') ??
                        (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT') ??
                        'http://localhost:4317',
                    timeout: timeoutExporter,
                    temporality_preference: temporalityPreference,
                    default_histogram_aggregation: defaultHistogramAggregation,
                    ...(tls !== undefined && { tls }),
                    ...(compression !== undefined && { compression }),
                    ...(headersList !== undefined && { headers_list: headersList }),
                };
                readerPeriodicInfo.exporter = { otlp_grpc: otlpGrpc };
            }
            else {
                const tls = (0, utils_1.getHttpTlsConfig)(certificateFile, clientKeyFile, clientCertificateFile);
                const encoding = protocol === 'http/json'
                    ? 'json'
                    : protocol === 'http/protobuf'
                        ? 'protobuf'
                        : undefined;
                const otlpHttp = {
                    endpoint: (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT') ??
                        ((0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT')
                            ? `${(0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT')}/v1/metrics`
                            : 'http://localhost:4318/v1/metrics'),
                    timeout: timeoutExporter,
                    temporality_preference: temporalityPreference,
                    default_histogram_aggregation: defaultHistogramAggregation,
                    ...(tls !== undefined && { tls }),
                    ...(compression !== undefined && { compression }),
                    ...(headersList !== undefined && { headers_list: headersList }),
                    ...(encoding !== undefined && { encoding }),
                };
                readerPeriodicInfo.exporter = { otlp_http: otlpHttp };
            }
        }
        config.meter_provider.readers.push({ periodic: readerPeriodicInfo });
    }
    const rawExemplarFilter = (0, core_1.getStringFromEnv)('OTEL_METRICS_EXEMPLAR_FILTER') ?? 'trace_based';
    config.meter_provider.exemplar_filter =
        rawExemplarFilter === 'default'
            ? 'trace_based'
            : rawExemplarFilter;
}
exports.setMeterProvider = setMeterProvider;
function setLoggerProvider(config) {
    const exportersType = Array.from(new Set((0, core_1.getStringListFromEnv)('OTEL_LOGS_EXPORTER')));
    if (exportersType.length === 0) {
        return;
    }
    if (exportersType.includes('none')) {
        api_1.diag.info('OTEL_LOGS_EXPORTER contains "none". Logger provider will not be initialized.');
        return;
    }
    config.logger_provider = (0, utils_1.initializeDefaultLoggerProviderConfiguration)();
    const attributeValueLengthLimit = (0, core_1.getNumberFromEnv)('OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT');
    const attributeCountLimit = (0, core_1.getNumberFromEnv)('OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT');
    if (attributeValueLengthLimit || attributeCountLimit) {
        if (attributeValueLengthLimit) {
            config.logger_provider.limits.attribute_value_length_limit =
                attributeValueLengthLimit;
        }
        if (attributeCountLimit) {
            config.logger_provider.limits.attribute_count_limit =
                attributeCountLimit;
        }
    }
    const batch = {
        exporter: {},
        schedule_delay: (0, core_1.getNumberFromEnv)('OTEL_BLRP_SCHEDULE_DELAY') ?? 1000,
        export_timeout: (0, core_1.getNumberFromEnv)('OTEL_BLRP_EXPORT_TIMEOUT') ?? 30000,
        max_queue_size: (0, core_1.getNumberFromEnv)('OTEL_BLRP_MAX_QUEUE_SIZE') ?? 2048,
        max_export_batch_size: (0, core_1.getNumberFromEnv)('OTEL_BLRP_MAX_EXPORT_BATCH_SIZE') ?? 512,
    };
    for (let i = 0; i < exportersType.length; i++) {
        const exporterType = exportersType[i];
        const batchInfo = {
            ...batch,
            exporter: {},
        };
        if (exporterType === 'console') {
            const processor = {
                simple: { exporter: { console: {} } },
            };
            config.logger_provider.processors.push(processor);
        }
        else {
            const protocol = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_PROTOCOL') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_PROTOCOL') ??
                'http/protobuf';
            const certificateFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CERTIFICATE');
            const clientKeyFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_CLIENT_KEY') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CLIENT_KEY');
            const clientCertificateFile = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_CLIENT_CERTIFICATE') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE');
            const compression = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_COMPRESSION') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_COMPRESSION');
            const timeout = (0, core_1.getNumberFromEnv)('OTEL_EXPORTER_OTLP_LOGS_TIMEOUT') ??
                (0, core_1.getNumberFromEnv)('OTEL_EXPORTER_OTLP_TIMEOUT') ??
                10000;
            const headersList = (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_HEADERS') ??
                (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_HEADERS');
            if (protocol === 'grpc') {
                const tls = (0, utils_1.getGrpcTlsConfig)(certificateFile, clientKeyFile, clientCertificateFile);
                const otlpGrpc = {
                    endpoint: (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT') ??
                        (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT') ??
                        'http://localhost:4317',
                    timeout,
                    ...(tls !== undefined && { tls }),
                    ...(compression !== undefined && { compression }),
                    ...(headersList !== undefined && { headers_list: headersList }),
                };
                batchInfo.exporter = { otlp_grpc: otlpGrpc };
            }
            else {
                const tls = (0, utils_1.getHttpTlsConfig)(certificateFile, clientKeyFile, clientCertificateFile);
                const encoding = protocol === 'http/json'
                    ? 'json'
                    : protocol === 'http/protobuf'
                        ? 'protobuf'
                        : undefined;
                const otlpHttp = {
                    endpoint: (0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT') ??
                        ((0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT')
                            ? `${(0, core_1.getStringFromEnv)('OTEL_EXPORTER_OTLP_ENDPOINT')}/v1/logs`
                            : 'http://localhost:4318/v1/logs'),
                    timeout,
                    ...(tls !== undefined && { tls }),
                    ...(compression !== undefined && { compression }),
                    ...(headersList !== undefined && { headers_list: headersList }),
                    ...(encoding !== undefined && { encoding }),
                };
                batchInfo.exporter = { otlp_http: otlpHttp };
            }
            const processor = { batch: batchInfo };
            config.logger_provider.processors.push(processor);
        }
    }
}
exports.setLoggerProvider = setLoggerProvider;
//# sourceMappingURL=EnvironmentConfigFactory.js.map