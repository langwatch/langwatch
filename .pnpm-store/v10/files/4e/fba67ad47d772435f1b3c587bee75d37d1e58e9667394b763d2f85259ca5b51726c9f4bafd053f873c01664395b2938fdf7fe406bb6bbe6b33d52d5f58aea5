/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createBoundedQueueExportPromiseHandler } from './bounded-queue-export-promise-handler';
import { createOtlpExportDelegate } from './otlp-export-delegate';
export function createOtlpNetworkExportDelegate(options, serializer, metrics, transport) {
    return createOtlpExportDelegate({
        transport: transport,
        serializer,
        promiseHandler: createBoundedQueueExportPromiseHandler(options),
        metrics,
    }, { timeout: options.timeoutMillis });
}
//# sourceMappingURL=otlp-network-export-delegate.js.map