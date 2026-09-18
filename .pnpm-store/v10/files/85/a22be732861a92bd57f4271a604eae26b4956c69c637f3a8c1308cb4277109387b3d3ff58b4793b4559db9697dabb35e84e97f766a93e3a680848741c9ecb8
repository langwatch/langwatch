"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeHeaders = mergeHeaders;
exports.mergeOnlyDefinedHeaders = mergeOnlyDefinedHeaders;
function mergeHeaders(...headersArray) {
    const result = {};
    for (const [key, value] of headersArray
        .filter((headers) => headers != null)
        .flatMap((headers) => Object.entries(headers))) {
        const insensitiveKey = key.toLowerCase();
        if (value != null) {
            result[insensitiveKey] = value;
        }
        else if (insensitiveKey in result) {
            delete result[insensitiveKey];
        }
    }
    return result;
}
function mergeOnlyDefinedHeaders(...headersArray) {
    const result = {};
    for (const [key, value] of headersArray
        .filter((headers) => headers != null)
        .flatMap((headers) => Object.entries(headers))) {
        const insensitiveKey = key.toLowerCase();
        if (value != null) {
            result[insensitiveKey] = value;
        }
    }
    return result;
}
