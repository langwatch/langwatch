/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRetryingTransport } from './retrying-transport';
import { createOtlpNetworkExportDelegate } from './otlp-network-export-delegate';
import { createFetchTransport } from './transport/fetch-transport';
export function createOtlpFetchExportDelegate(options, serializer, metrics) {
    return createOtlpNetworkExportDelegate(options, serializer, metrics, createRetryingTransport({
        transport: createFetchTransport(options),
    }));
}
/**
 * @deprecated Use {@link createOtlpFetchExportDelegate} instead. Modern browsers use `fetch` with `keepAlive: true` when `sendBeacon` is used. Use a `fetch` polyfill that mimics this behavior to keep using `sendBeacon`.
 */
export function createOtlpSendBeaconExportDelegate(options, serializer, metrics) {
    return createOtlpFetchExportDelegate(options, serializer, metrics);
}
//# sourceMappingURL=otlp-browser-http-export-delegate.js.map