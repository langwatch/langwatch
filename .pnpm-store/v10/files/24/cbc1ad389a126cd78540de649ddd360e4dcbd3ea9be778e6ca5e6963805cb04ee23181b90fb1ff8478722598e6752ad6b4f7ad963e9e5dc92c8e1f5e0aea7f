"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeBinary = serializeBinary;
exports.toUint8ArrayFromBinary = toUint8ArrayFromBinary;
const base64_1 = require("./base64.js");
const smartString_1 = require("./smartString.js");
function serializeBinary(value) {
    if (value instanceof ArrayBuffer) {
        return {
            __type: 'ArrayBuffer',
            data: (0, base64_1.encodeUint8ArrayToBase64)(new Uint8Array(value)),
        };
    }
    if ((0, smartString_1.isArrayBufferView)(value)) {
        const view = value;
        return {
            __type: view.constructor.name,
            data: (0, base64_1.encodeUint8ArrayToBase64)(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
        };
    }
    if ((0, smartString_1.isNodeBuffer)(value)) {
        const view = value;
        return {
            __type: 'Buffer',
            data: (0, base64_1.encodeUint8ArrayToBase64)(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
        };
    }
    if ((0, smartString_1.isSerializedBufferSnapshot)(value)) {
        return {
            __type: 'Buffer',
            data: (0, base64_1.encodeUint8ArrayToBase64)(Uint8Array.from(value.data)),
        };
    }
    return undefined;
}
function toUint8ArrayFromBinary(value) {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if ((0, smartString_1.isArrayBufferView)(value)) {
        const view = value;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if ((0, smartString_1.isNodeBuffer)(value)) {
        const view = value;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if ((0, smartString_1.isSerializedBufferSnapshot)(value)) {
        return Uint8Array.from(value.data);
    }
    return undefined;
}
//# sourceMappingURL=binary.js.map