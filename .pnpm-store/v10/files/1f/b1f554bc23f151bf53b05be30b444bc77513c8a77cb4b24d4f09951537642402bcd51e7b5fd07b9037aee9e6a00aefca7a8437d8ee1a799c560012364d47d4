/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { millisToHrTime } from '@opentelemetry/core';
import { hashAttributes } from '../utils';
import { AttributeHashMap } from './HashMap';
/**
 * Internal interface.
 *
 * Allows synchronous collection of metrics. This processor should allow
 * allocation of new aggregation cells for metrics and convert cumulative
 * recording to delta data points.
 */
export class DeltaMetricProcessor {
    _activeCollectionStorage = new AttributeHashMap();
    // TODO: find a reasonable mean to clean the memo;
    // https://github.com/open-telemetry/opentelemetry-specification/pull/2208
    _cumulativeMemoStorage = new AttributeHashMap();
    _cardinalityLimit;
    _overflowAttributes = { 'otel.metric.overflow': true };
    _overflowHashCode;
    _aggregator;
    constructor(aggregator, aggregationCardinalityLimit) {
        this._aggregator = aggregator;
        this._cardinalityLimit = (aggregationCardinalityLimit ?? 2000) - 1;
        this._overflowHashCode = hashAttributes(this._overflowAttributes);
    }
    record(value, attributes, collectionTime) {
        let accumulation = this._activeCollectionStorage.get(attributes);
        if (!accumulation) {
            const hrTime = millisToHrTime(collectionTime);
            if (this._activeCollectionStorage.size >= this._cardinalityLimit) {
                const overflowAccumulation = this._activeCollectionStorage.getOrDefault(this._overflowAttributes, () => this._aggregator.createAccumulation(hrTime));
                overflowAccumulation?.record(value);
                return;
            }
            accumulation = this._aggregator.createAccumulation(hrTime);
            this._activeCollectionStorage.set(attributes, accumulation);
        }
        accumulation?.record(value);
    }
    batchCumulate(measurements, collectionTime) {
        for (const [originalAttributes, value, originalHashCode,] of measurements.entries()) {
            let attributes = originalAttributes;
            let hashCode = originalHashCode;
            const accumulation = this._aggregator.createAccumulation(collectionTime);
            accumulation?.record(value);
            let delta = accumulation;
            // Diff with recorded cumulative memo.
            if (this._cumulativeMemoStorage.has(attributes, hashCode)) {
                // has() returned true, previous is present.
                const previous = this._cumulativeMemoStorage.get(attributes, hashCode);
                delta = this._aggregator.diff(previous, accumulation);
            }
            else {
                // If the cardinality limit is reached, we need to change the attributes
                if (this._cumulativeMemoStorage.size >= this._cardinalityLimit) {
                    attributes = this._overflowAttributes;
                    hashCode = this._overflowHashCode;
                    if (this._cumulativeMemoStorage.has(attributes, hashCode)) {
                        // has() returned true, previous is present.
                        const previous = this._cumulativeMemoStorage.get(attributes, hashCode);
                        delta = this._aggregator.diff(previous, accumulation);
                    }
                }
            }
            // Merge with uncollected active delta.
            if (this._activeCollectionStorage.has(attributes, hashCode)) {
                // has() returned true, active is present.
                const active = this._activeCollectionStorage.get(attributes, hashCode);
                delta = this._aggregator.merge(active, delta);
            }
            // Save the current record and the delta record.
            this._cumulativeMemoStorage.set(attributes, accumulation, hashCode);
            this._activeCollectionStorage.set(attributes, delta, hashCode);
        }
    }
    /**
     * Returns a collection of delta metrics. Start time is the when first
     * time event collected.
     */
    collect() {
        const unreportedDelta = this._activeCollectionStorage;
        this._activeCollectionStorage = new AttributeHashMap();
        return unreportedDelta;
    }
}
//# sourceMappingURL=DeltaMetricProcessor.js.map