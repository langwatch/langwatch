/**
 * Encode a Uint8Array into a base64 string in both Node and browser environments.
 */
export function encodeUint8ArrayToBase64(data) {
    if (data.length === 0) {
        return '';
    }
    const globalBuffer = typeof globalThis !== 'undefined' && globalThis.Buffer
        ? globalThis.Buffer
        : undefined;
    if (globalBuffer) {
        return globalBuffer.from(data).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < data.length; i += 1) {
        binary += String.fromCharCode(data[i]);
    }
    if (typeof globalThis.btoa === 'function') {
        return globalThis.btoa(binary);
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let result = '';
    let i = 0;
    while (i < binary.length) {
        const c1 = binary.charCodeAt(i++);
        const c2 = binary.charCodeAt(i++);
        const c3 = binary.charCodeAt(i++);
        const enc1 = c1 >> 2;
        const enc2 = ((c1 & 0x3) << 4) | (c2 >> 4);
        const enc3 = isNaN(c2) ? 64 : ((c2 & 0xf) << 2) | (c3 >> 6);
        const enc4 = isNaN(c3) ? 64 : c3 & 0x3f;
        result +=
            chars.charAt(enc1) +
                chars.charAt(enc2) +
                chars.charAt(enc3) +
                chars.charAt(enc4);
    }
    return result;
}
//# sourceMappingURL=base64.mjs.map