"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBatchSpanProcessorFromEnv = exports.createSpanLimitsFromEnv = exports.createSamplerFromEnv = void 0;
const api_1 = require("@opentelemetry/api");
const core_1 = require("@opentelemetry/core");
const sdk_trace_1 = require("@opentelemetry/sdk-trace");
const sdk_trace_2 = require("@opentelemetry/sdk-trace");
const utils_1 = require("./utils");
const DEFAULT_RATIO = 1;
function createSamplerFromEnv() {
    const samplerName = (0, core_1.getStringFromEnv)('OTEL_TRACES_SAMPLER');
    if (samplerName === undefined) {
        return undefined;
    }
    switch (samplerName) {
        case 'always_on':
            return new sdk_trace_2.AlwaysOnSampler();
        case 'always_off':
            return new sdk_trace_2.AlwaysOffSampler();
        case 'parentbased_always_on':
            return new sdk_trace_2.ParentBasedSampler({
                root: new sdk_trace_2.AlwaysOnSampler(),
            });
        case 'parentbased_always_off':
            return new sdk_trace_2.ParentBasedSampler({
                root: new sdk_trace_2.AlwaysOffSampler(),
            });
        case 'traceidratio':
            return new sdk_trace_2.TraceIdRatioBasedSampler(getSamplerRatioFromEnv());
        case 'parentbased_traceidratio':
            return new sdk_trace_2.ParentBasedSampler({
                root: new sdk_trace_2.TraceIdRatioBasedSampler(getSamplerRatioFromEnv()),
            });
        default:
            api_1.diag.error(`unknown OTEL_TRACES_SAMPLER value "${samplerName}", using default`);
            return undefined;
    }
}
exports.createSamplerFromEnv = createSamplerFromEnv;
function getSamplerRatioFromEnv() {
    const ratio = (0, core_1.getNumberFromEnv)('OTEL_TRACES_SAMPLER_ARG');
    if (ratio == null) {
        api_1.diag.error(`OTEL_TRACES_SAMPLER_ARG is blank, defaulting to ${DEFAULT_RATIO}.`);
        return DEFAULT_RATIO;
    }
    if (ratio < 0 || ratio > 1) {
        api_1.diag.error(`OTEL_TRACES_SAMPLER_ARG=${ratio} was given, but it is out of range ([0..1]), defaulting to ${DEFAULT_RATIO}.`);
        return DEFAULT_RATIO;
    }
    return ratio;
}
function createSpanLimitsFromEnv() {
    return {
        attributeCountLimit: (0, core_1.getNumberFromEnv)('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT') ??
            (0, core_1.getNumberFromEnv)('OTEL_ATTRIBUTE_COUNT_LIMIT'),
        attributeValueLengthLimit: (0, core_1.getNumberFromEnv)('OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT') ??
            (0, core_1.getNumberFromEnv)('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT'),
        eventCountLimit: (0, core_1.getNumberFromEnv)('OTEL_SPAN_EVENT_COUNT_LIMIT'),
        linkCountLimit: (0, core_1.getNumberFromEnv)('OTEL_SPAN_LINK_COUNT_LIMIT'),
        attributePerEventCountLimit: (0, core_1.getNumberFromEnv)('OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT'),
        attributePerLinkCountLimit: (0, core_1.getNumberFromEnv)('OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT'),
    };
}
exports.createSpanLimitsFromEnv = createSpanLimitsFromEnv;
function createBatchSpanProcessorFromEnv(exporter, selfObsMeterProvider) {
    return new sdk_trace_1.BatchSpanProcessor({
        exporter,
        selfObsMeterProvider,
        maxQueueSize: (0, utils_1.getNonNegativeNumberFromEnv)('OTEL_BSP_MAX_QUEUE_SIZE'),
        scheduledDelayMillis: (0, utils_1.getNonNegativeNumberFromEnv)('OTEL_BSP_SCHEDULE_DELAY'),
        exportTimeoutMillis: (0, utils_1.getNonNegativeNumberFromEnv)('OTEL_BSP_EXPORT_TIMEOUT'),
        maxExportBatchSize: (0, utils_1.getNonNegativeNumberFromEnv)('OTEL_BSP_MAX_EXPORT_BATCH_SIZE'),
    });
}
exports.createBatchSpanProcessorFromEnv = createBatchSpanProcessorFromEnv;
//# sourceMappingURL=create-from-env.js.map