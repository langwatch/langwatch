"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeAsFormParameter = encodeAsFormParameter;
const qs_1 = require("../url/qs");
function encodeAsFormParameter(value) {
    const stringified = (0, qs_1.toQueryString)(value, { encode: false });
    const keyValuePairs = stringified.split("&").map((pair) => {
        const [key, value] = pair.split("=");
        return [key, value];
    });
    return Object.fromEntries(keyValuePairs);
}
