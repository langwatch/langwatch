const BYTE_PREVIEW_LIMIT = 20;
export function toSmartString(value) {
    // Produce a human-friendly string representation while preserving enough detail for debugging workflows.
    if (value === null || value === undefined) {
        return String(value);
    }
    if (isArrayBufferLike(value)) {
        return formatByteArray(new Uint8Array(value));
    }
    if (isArrayBufferView(value)) {
        const view = value;
        return formatByteArray(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, smartStringReplacer);
        }
        catch (_e) {
            return '[object with circular references]';
        }
    }
    return String(value);
}
export function isArrayBufferLike(value) {
    // Detect raw ArrayBuffer-backed payloads so callers can generate full previews rather than truncated hashes.
    if (value instanceof ArrayBuffer) {
        return true;
    }
    const sharedArrayBufferCtor = globalThis.SharedArrayBuffer;
    return Boolean(sharedArrayBufferCtor && value instanceof sharedArrayBufferCtor);
}
export function isArrayBufferView(value) {
    // Treat typed array views as binary data for consistent serialization.
    return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value);
}
export function isSerializedBufferSnapshot(value) {
    // Support serialized Buffer snapshots (e.g., from JSON.parse) emitted by some tool outputs.
    return (typeof value === 'object' &&
        value !== null &&
        value.type === 'Buffer' &&
        Array.isArray(value.data));
}
export function isNodeBuffer(value) {
    // Detect runtime Buffers without importing node-specific shims, handling browser builds gracefully.
    const bufferCtor = globalThis.Buffer;
    return Boolean(bufferCtor &&
        typeof bufferCtor.isBuffer === 'function' &&
        bufferCtor.isBuffer(value));
}
function formatByteArray(bytes) {
    if (bytes.length === 0) {
        return '[byte array (0 bytes)]';
    }
    const previewLength = Math.min(bytes.length, BYTE_PREVIEW_LIMIT);
    const previewParts = [];
    for (let i = 0; i < previewLength; i++) {
        previewParts.push(formatByte(bytes[i]));
    }
    const ellipsis = bytes.length > BYTE_PREVIEW_LIMIT ? ' …' : '';
    const preview = previewParts.join(' ');
    return `[byte array ${preview}${ellipsis} (${bytes.length} bytes)]`;
}
function formatByte(byte) {
    return `0x${byte.toString(16).padStart(2, '0')}`;
}
function smartStringReplacer(_key, nestedValue) {
    if (isArrayBufferLike(nestedValue)) {
        return formatByteArray(new Uint8Array(nestedValue));
    }
    if (isArrayBufferView(nestedValue)) {
        const view = nestedValue;
        return formatByteArray(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }
    if (isSerializedBufferSnapshot(nestedValue)) {
        return formatByteArray(Uint8Array.from(nestedValue.data));
    }
    return nestedValue;
}
//# sourceMappingURL=smartString.mjs.map