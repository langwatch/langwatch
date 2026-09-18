import { encodeUint8ArrayToBase64 } from "./base64.mjs";
import { isArrayBufferView, isNodeBuffer, isSerializedBufferSnapshot, } from "./smartString.mjs";
export function serializeBinary(value) {
    if (value instanceof ArrayBuffer) {
        return {
            __type: 'ArrayBuffer',
            data: encodeUint8ArrayToBase64(new Uint8Array(value)),
        };
    }
    if (isArrayBufferView(value)) {
        const view = value;
        return {
            __type: view.constructor.name,
            data: encodeUint8ArrayToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
        };
    }
    if (isNodeBuffer(value)) {
        const view = value;
        return {
            __type: 'Buffer',
            data: encodeUint8ArrayToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
        };
    }
    if (isSerializedBufferSnapshot(value)) {
        return {
            __type: 'Buffer',
            data: encodeUint8ArrayToBase64(Uint8Array.from(value.data)),
        };
    }
    return undefined;
}
export function toUint8ArrayFromBinary(value) {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (isArrayBufferView(value)) {
        const view = value;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if (isNodeBuffer(value)) {
        const view = value;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if (isSerializedBufferSnapshot(value)) {
        return Uint8Array.from(value.data);
    }
    return undefined;
}
//# sourceMappingURL=binary.mjs.map