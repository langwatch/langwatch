"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtobufMetricsSerializer = void 0;
const metrics_serializer_1 = require("./metrics-serializer");
const response_deserializer_1 = require("./response-deserializer");
/*
 * @experimental this serializer may receive breaking changes in minor versions, pin this package's version when using this constant
 */
exports.ProtobufMetricsSerializer = {
    serializeRequest: (arg) => {
        return (0, metrics_serializer_1.serializeMetricsExportRequest)(arg);
    },
    deserializeResponse: (arg) => {
        return (0, response_deserializer_1.deserializeExportMetricsServiceResponse)(arg);
    },
};
//# sourceMappingURL=metrics.js.map