"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtobufLogsSerializer = void 0;
const logs_serializer_1 = require("./logs-serializer");
const response_deserializer_1 = require("./response-deserializer");
/*
 * @experimental this serializer may receive breaking changes in minor versions, pin this package's version when using this constant
 */
exports.ProtobufLogsSerializer = {
    serializeRequest: (arg) => {
        return (0, logs_serializer_1.serializeLogsExportRequest)(arg);
    },
    deserializeResponse: (arg) => {
        return (0, response_deserializer_1.deserializeExportLogsServiceResponse)(arg);
    },
};
//# sourceMappingURL=logs.js.map