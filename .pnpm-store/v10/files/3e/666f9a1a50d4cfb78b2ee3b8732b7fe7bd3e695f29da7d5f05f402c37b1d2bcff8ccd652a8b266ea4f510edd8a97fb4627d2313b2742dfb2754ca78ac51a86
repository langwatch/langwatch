/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { serializeLogsExportRequest } from './logs-serializer';
import { deserializeExportLogsServiceResponse } from './response-deserializer';
/*
 * @experimental this serializer may receive breaking changes in minor versions, pin this package's version when using this constant
 */
export const ProtobufLogsSerializer = {
    serializeRequest: (arg) => {
        return serializeLogsExportRequest(arg);
    },
    deserializeResponse: (arg) => {
        return deserializeExportLogsServiceResponse(arg);
    },
};
//# sourceMappingURL=logs.js.map