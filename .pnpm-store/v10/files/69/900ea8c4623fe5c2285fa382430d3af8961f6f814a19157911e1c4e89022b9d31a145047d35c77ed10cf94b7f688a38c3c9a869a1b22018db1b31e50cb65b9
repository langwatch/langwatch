"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtobufTraceSerializer = void 0;
const trace_serializer_1 = require("./trace-serializer");
const response_deserializer_1 = require("./response-deserializer");
exports.ProtobufTraceSerializer = {
    serializeRequest: (arg) => {
        return (0, trace_serializer_1.serializeTraceExportRequest)(arg);
    },
    deserializeResponse: (arg) => {
        return (0, response_deserializer_1.deserializeExportTraceServiceResponse)(arg);
    },
};
//# sourceMappingURL=trace.js.map