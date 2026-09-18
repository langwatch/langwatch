import { collectBody } from "@smithy/core/protocols";
import { collectBodyString } from "../common";
import { detectBufferParsing } from "./detectBufferParsing";
import { jsonReviver } from "./jsonReviver";
import { needsReviver } from "./needsReviver";
export async function parseJsonBody(streamBody, context, schema) {
    let parsingInput;
    if (detectBufferParsing() && typeof streamBody?.[Symbol.asyncIterator] === "function") {
        const buffer = await collectBody(streamBody, context);
        if (typeof Buffer === "function") {
            if (Buffer.isBuffer(buffer)) {
                parsingInput = buffer;
            }
            else {
                parsingInput = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            }
        }
    }
    if (!parsingInput) {
        parsingInput = await collectBodyString(streamBody, context);
    }
    if (parsingInput.length === 0) {
        return {};
    }
    const reviver = schema && needsReviver(schema) ? jsonReviver : undefined;
    try {
        return JSON.parse(parsingInput, reviver);
    }
    catch (e) {
        if (e?.name === "SyntaxError") {
            Object.defineProperty(e, "$responseBodyText", {
                value: typeof parsingInput === "string" ? parsingInput : parsingInput.toString("utf8"),
            });
        }
        throw e;
    }
}
export const parseJsonErrorBody = async (errorBody, context) => {
    const value = await parseJsonBody(errorBody, context);
    value.message = value.message ?? value.Message;
    return value;
};
const findKey = (object, key) => Object.keys(object).find((k) => k.toLowerCase() === key.toLowerCase());
const sanitizeErrorCode = (rawValue) => {
    let cleanValue = rawValue;
    if (typeof cleanValue === "number") {
        cleanValue = cleanValue.toString();
    }
    if (cleanValue.indexOf(",") >= 0) {
        cleanValue = cleanValue.split(",")[0];
    }
    if (cleanValue.indexOf(":") >= 0) {
        cleanValue = cleanValue.split(":")[0];
    }
    if (cleanValue.indexOf("#") >= 0) {
        cleanValue = cleanValue.split("#")[1];
    }
    return cleanValue;
};
export const loadRestJsonErrorCode = (output, data) => {
    return loadErrorCode(output, data, ["header", "code", "type"]);
};
export const loadJsonRpcErrorCode = (output, data, queryCompat = false) => {
    return loadErrorCode(output, data, queryCompat ? ["code", "header", "type"] : ["type", "code", "header"]);
};
const loadErrorCode = ({ headers }, data, order) => {
    while (order.length > 0) {
        const location = order.shift();
        switch (location) {
            case "header":
                const headerKey = findKey(headers ?? {}, "x-amzn-errortype");
                if (headerKey !== undefined) {
                    return sanitizeErrorCode(headers[headerKey]);
                }
                break;
            case "code":
                const codeKey = findKey(data ?? {}, "code");
                if (codeKey && data[codeKey] !== undefined) {
                    return sanitizeErrorCode(data[codeKey]);
                }
                break;
            case "type":
                if (data?.__type !== undefined) {
                    return sanitizeErrorCode(data.__type);
                }
                break;
        }
    }
};
