"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOtlpSendBeaconExportDelegate = exports.createOtlpFetchExportDelegate = void 0;
const retrying_transport_1 = require("./retrying-transport");
const otlp_network_export_delegate_1 = require("./otlp-network-export-delegate");
const fetch_transport_1 = require("./transport/fetch-transport");
function createOtlpFetchExportDelegate(options, serializer, metrics) {
    return (0, otlp_network_export_delegate_1.createOtlpNetworkExportDelegate)(options, serializer, metrics, (0, retrying_transport_1.createRetryingTransport)({
        transport: (0, fetch_transport_1.createFetchTransport)(options),
    }));
}
exports.createOtlpFetchExportDelegate = createOtlpFetchExportDelegate;
/**
 * @deprecated Use {@link createOtlpFetchExportDelegate} instead. Modern browsers use `fetch` with `keepAlive: true` when `sendBeacon` is used. Use a `fetch` polyfill that mimics this behavior to keep using `sendBeacon`.
 */
function createOtlpSendBeaconExportDelegate(options, serializer, metrics) {
    return createOtlpFetchExportDelegate(options, serializer, metrics);
}
exports.createOtlpSendBeaconExportDelegate = createOtlpSendBeaconExportDelegate;
//# sourceMappingURL=otlp-browser-http-export-delegate.js.map