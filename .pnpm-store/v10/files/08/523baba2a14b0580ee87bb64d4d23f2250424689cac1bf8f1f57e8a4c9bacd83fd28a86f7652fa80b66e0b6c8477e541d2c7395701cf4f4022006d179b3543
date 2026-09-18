/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { context as contextApi } from '@opentelemetry/api';
/**
 * Internal interface.
 */
export class MultiMetricStorage {
    _backingStorages;
    hasAttributeProcessor;
    constructor(backingStorages) {
        this._backingStorages = backingStorages;
        this.hasAttributeProcessor = backingStorages.some(s => s.hasAttributeProcessor);
    }
    record(value, attributes, context, recordTime) {
        if (this.hasAttributeProcessor && context === undefined) {
            context = contextApi.active();
        }
        const storages = this._backingStorages;
        for (let i = 0; i < storages.length; i++) {
            storages[i].record(value, attributes, context, recordTime);
        }
    }
}
//# sourceMappingURL=MultiWritableMetricStorage.js.map