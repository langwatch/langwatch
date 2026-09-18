/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { serializeMetricsExportRequest } from './metrics-serializer';
import { deserializeExportMetricsServiceResponse } from './response-deserializer';
/*
 * @experimental this serializer may receive breaking changes in minor versions, pin this package's version when using this constant
 */
export const ProtobufMetricsSerializer = {
    serializeRequest: (arg) => {
        return serializeMetricsExportRequest(arg);
    },
    deserializeResponse: (arg) => {
        return deserializeExportMetricsServiceResponse(arg);
    },
};
//# sourceMappingURL=metrics.js.map