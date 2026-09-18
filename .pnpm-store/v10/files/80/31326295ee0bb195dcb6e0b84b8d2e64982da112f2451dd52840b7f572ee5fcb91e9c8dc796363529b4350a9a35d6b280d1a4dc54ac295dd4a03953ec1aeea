"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiMetricStorage = void 0;
const api_1 = require("@opentelemetry/api");
/**
 * Internal interface.
 */
class MultiMetricStorage {
    _backingStorages;
    hasAttributeProcessor;
    constructor(backingStorages) {
        this._backingStorages = backingStorages;
        this.hasAttributeProcessor = backingStorages.some(s => s.hasAttributeProcessor);
    }
    record(value, attributes, context, recordTime) {
        if (this.hasAttributeProcessor && context === undefined) {
            context = api_1.context.active();
        }
        const storages = this._backingStorages;
        for (let i = 0; i < storages.length; i++) {
            storages[i].record(value, attributes, context, recordTime);
        }
    }
}
exports.MultiMetricStorage = MultiMetricStorage;
//# sourceMappingURL=MultiWritableMetricStorage.js.map