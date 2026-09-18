"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAlwaysRecordSampler = void 0;
const Sampler_1 = require("../Sampler");
/**
 * Creates a sampler that wraps a delegate and upgrades NOT_RECORD decisions to
 * RECORD, ensuring all spans are recorded without affecting the sampling rate.
 */
function createAlwaysRecordSampler(delegate) {
    if (!delegate) {
        throw new Error('createAlwaysRecordSampler requires a delegate sampler');
    }
    return {
        shouldSample(context, traceId, spanName, spanKind, attributes, links) {
            const result = delegate.shouldSample(context, traceId, spanName, spanKind, attributes, links);
            if (result.decision === Sampler_1.SamplingDecision.NOT_RECORD) {
                return {
                    decision: Sampler_1.SamplingDecision.RECORD,
                    attributes: result.attributes,
                    traceState: result.traceState,
                };
            }
            return result;
        },
        toString() {
            return `AlwaysRecordSampler{${delegate.toString()}}`;
        },
    };
}
exports.createAlwaysRecordSampler = createAlwaysRecordSampler;
//# sourceMappingURL=AlwaysRecordSampler.js.map