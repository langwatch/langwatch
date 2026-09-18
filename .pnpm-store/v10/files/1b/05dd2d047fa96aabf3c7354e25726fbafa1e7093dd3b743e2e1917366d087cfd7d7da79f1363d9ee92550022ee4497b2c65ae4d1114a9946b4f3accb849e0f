import type { Context, HrTime, Attributes } from '@opentelemetry/api';
import type { AttributeHashMap } from './HashMap';
/**
 * Internal interface. Stores measurements and allows synchronous writes of
 * measurements.
 *
 * An interface representing SyncMetricStorage with type parameters removed.
 */
export interface WritableMetricStorage {
    /** Whether this storage has an attribute processor that needs context. */
    hasAttributeProcessor: boolean;
    /** Records a measurement. */
    record(value: number, attributes: Attributes, context: Context | undefined, recordTime: number): void;
}
/**
 * Internal interface. Stores measurements and allows asynchronous writes of
 * measurements.
 *
 * An interface representing AsyncMetricStorage with type parameters removed.
 */
export interface AsyncWritableMetricStorage {
    /** Records a batch of measurements. */
    record(measurements: AttributeHashMap<number>, observationTime: HrTime): void;
}
//# sourceMappingURL=WritableMetricStorage.d.ts.map