"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV_DEFS = exports.SamplerType = void 0;
var SamplerType;
(function (SamplerType) {
    SamplerType["AlwaysOn"] = "always_on";
    SamplerType["AlwaysOff"] = "always_off";
    SamplerType["TraceIdRatio"] = "traceidratio";
    SamplerType["ParentBasedAlwaysOn"] = "parentbased_always_on";
    SamplerType["ParentBasedAlwaysOff"] = "parentbased_always_off";
    SamplerType["ParentBasedTraceIdRatio"] = "parentbased_traceidratio";
})(SamplerType || (exports.SamplerType = SamplerType = {}));
exports.ENV_DEFS = {
    OTEL_SDK_DISABLED: {
        key: 'OTEL_SDK_DISABLED',
        type: 'boolean',
        description: 'Disable the SDK',
        defaultValue: false,
    },
    OTEL_TRACES_SAMPLER: {
        key: 'OTEL_TRACES_SAMPLER',
        type: 'string',
        description: 'Traces sampler',
        allowedValues: Object.values(SamplerType),
    },
    OTEL_TRACES_SAMPLER_ARG: {
        key: 'OTEL_TRACES_SAMPLER_ARG',
        type: 'string',
        description: 'Traces sampler argument',
    },
};
//# sourceMappingURL=EnvDefinition.js.map