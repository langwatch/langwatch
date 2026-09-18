import type { Context, Attributes } from '@opentelemetry/api';
import type { WritableMetricStorage } from './WritableMetricStorage';
/**
 * Internal interface.
 */
export declare class MultiMetricStorage implements WritableMetricStorage {
    private readonly _backingStorages;
    readonly hasAttributeProcessor: boolean;
    constructor(backingStorages: WritableMetricStorage[]);
    record(value: number, attributes: Attributes, context: Context | undefined, recordTime: number): void;
}
//# sourceMappingURL=MultiWritableMetricStorage.d.ts.map