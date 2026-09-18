"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSpanLimitsFromConfig = exports.createLoggerProviderFromConfig = exports.createLogRecordProcessorFromConfig = exports.createLogRecordExporterFromConfig = exports.createLogRecordLimitsFromConfig = void 0;
/**
 * Create SDK components from parsed declarative config.
 * https://opentelemetry.io/docs/specs/otel/configuration/sdk/#create
 *
 * Dev Notes:
 * This file exports `create<SDK Thing>FromConfig(...)` functions intended to
 * be used by the "create" step of `startNodeSDK()`.
 */
const api_1 = require("@opentelemetry/api");
const exporter_logs_otlp_http_1 = require("@opentelemetry/exporter-logs-otlp-http");
const exporter_logs_otlp_grpc_1 = require("@opentelemetry/exporter-logs-otlp-grpc");
const exporter_logs_otlp_proto_1 = require("@opentelemetry/exporter-logs-otlp-proto");
const otlp_exporter_base_1 = require("@opentelemetry/otlp-exporter-base");
const sdk_logs_1 = require("@opentelemetry/sdk-logs");
const utils_1 = require("./utils");
// ---- internal utilities
/**
 * Warn if some props from a declarative config object have not been handled.
 *
 * This is intended to be used by `create*FromConfig()` functions. It is a low
 * tech mechanism to add awareness when a given valid config is not being
 * completely handled. This could help when properties are added to the
 * configuration schema. (A higher tech mechanism that wraps the parsed
 * configuration during `create()` and watches for untouched properties
 * might be nice.)
 */
function checkConfigUse(name, props, handledProps) {
    if (!props)
        return;
    // Dev note: I'd use Set#difference, but that requires Node.js v22.
    const unhandledProps = Object.keys(props).filter(k => !handledProps.includes(k));
    if (unhandledProps.length > 0) {
        api_1.diag.warn(`Config warning: some specified ${name} configuration properties were not handled by SDK setup: ${JSON.stringify(unhandledProps)}`);
    }
}
/**
 * Return the single non-undefined entry in the given config object, or throw.
 *
 * It is common for Declarative Configuration to have config objects with
 * a single entry, e.g.
 *
 *    "LogRecordProcessor": {
 *      "type": "object",
 *      "additionalProperties": {
 *        "type": [
 *          "object",
 *          "null"
 *        ]
 *      },
 *      "minProperties": 1,
 *      "maxProperties": 1,
 *
 * The TypeScript types cannot express the minProperties/maxProperties from the
 * JSON schema. We guard against that here.
 */
function mustSingleEntry(configObj, configTypeName) {
    const entries = Object.entries(configObj).filter(([_name, properties]) => properties !== undefined);
    if (entries.length !== 1) {
        const entryNames = entries.map(e => e[0]);
        throw Error(`invalid ${configTypeName} in configuration: must have exactly one entry: entries=${JSON.stringify(entryNames)}`);
    }
    return entries[0];
}
// ---- create<SDKThing>FromConfig functions
function createLogRecordLimitsFromConfig(limits, attribute_limits) {
    if (!limits && !attribute_limits) {
        return undefined;
    }
    return {
        attributeValueLengthLimit: limits?.attribute_value_length_limit ??
            attribute_limits?.attribute_value_length_limit ??
            undefined,
        attributeCountLimit: limits?.attribute_count_limit ??
            attribute_limits?.attribute_count_limit ??
            undefined,
    };
}
exports.createLogRecordLimitsFromConfig = createLogRecordLimitsFromConfig;
function createLogRecordExporterFromConfig(exporter) {
    const [name, properties] = mustSingleEntry(exporter, 'LogRecordExporter');
    switch (name) {
        case 'otlp_http': {
            checkConfigUse('LogRecordExporter', properties, [
                'compression',
                'endpoint',
                'headers',
                'timeout',
                'tls',
                'encoding',
            ]);
            const props = properties;
            const commonOpts = {
                compression: props?.compression === 'gzip'
                    ? otlp_exporter_base_1.CompressionAlgorithm.GZIP
                    : otlp_exporter_base_1.CompressionAlgorithm.NONE,
                url: props?.endpoint ?? undefined,
                headers: (0, utils_1.getHeadersFromConfiguration)(props?.headers),
                timeoutMillis: (0, utils_1.validateExporterTimeout)(props?.timeout),
                httpAgentOptions: (0, utils_1.getHttpAgentOptionsFromTls)(props?.tls),
            };
            const encoding = props?.encoding ?? 'protobuf';
            switch (encoding) {
                case 'json':
                    return new exporter_logs_otlp_http_1.OTLPLogExporter(commonOpts);
                case 'protobuf':
                    return new exporter_logs_otlp_proto_1.OTLPLogExporter(commonOpts);
                default:
                    throw new Error(`unknown OtlpHttpExporter encoding in configuration: "${encoding}"`);
            }
        }
        case 'otlp_grpc': {
            checkConfigUse('LogRecordExporter', properties, [
                'compression',
                'endpoint',
                'timeout',
                'tls',
                'headers',
            ]);
            const props = properties;
            return new exporter_logs_otlp_grpc_1.OTLPLogExporter({
                compression: props?.compression === 'gzip'
                    ? otlp_exporter_base_1.CompressionAlgorithm.GZIP
                    : otlp_exporter_base_1.CompressionAlgorithm.NONE,
                url: props?.endpoint ?? undefined,
                timeoutMillis: (0, utils_1.validateExporterTimeout)(props?.timeout),
                credentials: (0, utils_1.getGrpcCredentialsFromTls)(props?.tls),
                metadata: (0, utils_1.getGrpcMetadataFromHeaders)(props?.headers),
            });
        }
        case 'console':
            return new sdk_logs_1.ConsoleLogRecordExporter();
        default:
            throw new Error(`unknown LogRecordExporter name in configuration: "${name}"`);
    }
}
exports.createLogRecordExporterFromConfig = createLogRecordExporterFromConfig;
function createLogRecordProcessorFromConfig(processor) {
    const [name, properties] = mustSingleEntry(processor, 'LogRecordProcessor');
    switch (name) {
        case 'batch': {
            checkConfigUse('BatchLogRecordProcessor', properties, [
                'exporter',
                'max_queue_size',
                'max_export_batch_size',
                'schedule_delay',
                'export_timeout',
            ]);
            const props = properties;
            const exporter = createLogRecordExporterFromConfig(props.exporter);
            return new sdk_logs_1.BatchLogRecordProcessor({
                exporter,
                maxQueueSize: props.max_queue_size ?? undefined,
                maxExportBatchSize: props.max_export_batch_size ?? undefined,
                scheduledDelayMillis: props.schedule_delay ?? undefined,
                exportTimeoutMillis: props.export_timeout ?? undefined,
            });
        }
        case 'simple': {
            const props = properties;
            const exporter = createLogRecordExporterFromConfig(props.exporter);
            return new sdk_logs_1.SimpleLogRecordProcessor({ exporter });
        }
        default:
            throw new Error(`unknown LogRecordProcessor name: "${name}"`);
    }
}
exports.createLogRecordProcessorFromConfig = createLogRecordProcessorFromConfig;
function createLoggerProviderFromConfig(resource, logger_provider, attribute_limits) {
    const processors = logger_provider.processors.map(p => createLogRecordProcessorFromConfig(p));
    const logRecordLimits = createLogRecordLimitsFromConfig(logger_provider.limits, attribute_limits);
    checkConfigUse('LoggerProvider', logger_provider, ['processors', 'limits']);
    return new sdk_logs_1.LoggerProvider({
        resource,
        processors,
        logRecordLimits,
        // TODO: loggerConfigurator
        // TODO: meterProvider
        // Note: forceFlushTimeoutMillis not configurable via decl conf.
    });
}
exports.createLoggerProviderFromConfig = createLoggerProviderFromConfig;
function createSpanLimitsFromConfig(limits, attribute_limits) {
    if (!limits && !attribute_limits) {
        return undefined;
    }
    return {
        attributeValueLengthLimit: limits?.attribute_value_length_limit ??
            attribute_limits?.attribute_value_length_limit ??
            undefined,
        attributeCountLimit: limits?.attribute_count_limit ??
            attribute_limits?.attribute_count_limit ??
            undefined,
        eventCountLimit: limits?.event_count_limit ?? undefined,
        linkCountLimit: limits?.link_count_limit ?? undefined,
        attributePerEventCountLimit: limits?.event_attribute_count_limit ?? undefined,
        attributePerLinkCountLimit: limits?.link_attribute_count_limit ?? undefined,
    };
}
exports.createSpanLimitsFromConfig = createSpanLimitsFromConfig;
//# sourceMappingURL=create-from-config.js.map