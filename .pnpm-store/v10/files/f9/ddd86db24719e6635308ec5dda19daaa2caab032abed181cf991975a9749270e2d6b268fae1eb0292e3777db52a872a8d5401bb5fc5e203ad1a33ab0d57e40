import { createExportLogsServiceRequest } from '../internal';
import { JSON_ENCODER } from '../../common/utils';
import { diag } from '@opentelemetry/api';
/*
 * @experimental this serializer may receive breaking changes in minor versions, pin this package's version when using this constant
 */
export const JsonLogsSerializer = {
    serializeRequest: (arg) => {
        const request = createExportLogsServiceRequest(arg, JSON_ENCODER);
        const encoder = new TextEncoder();
        return encoder.encode(JSON.stringify(request));
    },
    deserializeResponse: (arg) => {
        if (arg.length === 0) {
            return {};
        }
        const decoder = new TextDecoder();
        try {
            return JSON.parse(decoder.decode(arg));
        }
        catch (err) {
            diag.warn(`Failed to parse logs export response: ${err.message}. Returning empty response`);
            return {};
        }
    },
};
//# sourceMappingURL=logs.js.map