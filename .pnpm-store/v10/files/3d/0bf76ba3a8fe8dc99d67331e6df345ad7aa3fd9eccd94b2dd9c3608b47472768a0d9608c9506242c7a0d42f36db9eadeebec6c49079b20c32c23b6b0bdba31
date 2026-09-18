import { createExportTraceServiceRequest } from '../internal';
import { JSON_ENCODER } from '../../common/utils';
import { diag } from '@opentelemetry/api';
export const JsonTraceSerializer = {
    serializeRequest: (arg) => {
        const request = createExportTraceServiceRequest(arg, JSON_ENCODER);
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
            diag.warn(`Failed to parse trace export response: ${err.message}. Returning empty response`);
            return {};
        }
    },
};
//# sourceMappingURL=trace.js.map