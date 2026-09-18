/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { SamplingDecision } from '../Sampler';
/**
 * Creates a sampler that wraps a delegate and upgrades NOT_RECORD decisions to
 * RECORD, ensuring all spans are recorded without affecting the sampling rate.
 */
export function createAlwaysRecordSampler(delegate) {
    if (!delegate) {
        throw new Error('createAlwaysRecordSampler requires a delegate sampler');
    }
    return {
        shouldSample(context, traceId, spanName, spanKind, attributes, links) {
            const result = delegate.shouldSample(context, traceId, spanName, spanKind, attributes, links);
            if (result.decision === SamplingDecision.NOT_RECORD) {
                return {
                    decision: SamplingDecision.RECORD,
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
//# sourceMappingURL=AlwaysRecordSampler.js.map