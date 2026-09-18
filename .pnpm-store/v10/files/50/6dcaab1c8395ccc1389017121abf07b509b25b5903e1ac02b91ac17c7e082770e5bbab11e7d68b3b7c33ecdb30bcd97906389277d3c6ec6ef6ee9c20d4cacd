/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { estimateVarintSize } from './utils';
/**
 * Calculate UTF-8 byte length without encoding
 * @param str valid UTF-16 string
 */
function utf8ByteLength(str) {
    // No quick path for ASCII, since we need to loop though all chars anyway.
    const len = str.length;
    let byteLen = 0;
    for (let i = 0; i < len; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) {
            byteLen += 1;
        }
        else if (code < 0x800) {
            byteLen += 2;
        }
        else if (code < 0xd800 || code >= 0xe000) {
            byteLen += 3;
        }
        else {
            // Surrogate pair
            i++; // Skip the next character
            byteLen += 4;
        }
    }
    return byteLen;
}
/**
 * Size estimator for protobuf messages.
 * Implements the same interface as ProtobufWriter but only counts bytes without allocating a buffer.
 * @internal
 */
export class ProtobufSizeEstimator {
    pos = 0;
    startLengthDelimited() {
        return this.pos;
    }
    finishLengthDelimited(_, length) {
        this.pos += estimateVarintSize(length);
    }
    writeVarint(value) {
        this.pos += estimateVarintSize(value);
    }
    writeSint32(value) {
        // Zigzag encode: (n << 1) ^ (n >> 31)
        this.pos += estimateVarintSize(((value << 1) ^ (value >> 31)) >>> 0);
    }
    writeSfixed64(_value) {
        this.pos += 8;
    }
    writeFixed32(_value) {
        this.pos += 4;
    }
    writeFixed64(_low, _high) {
        this.pos += 8;
    }
    writeBytes(bytes) {
        this.pos += estimateVarintSize(bytes.length);
        this.pos += bytes.length;
    }
    writeTag(fieldNumber, wireType) {
        this.writeVarint((fieldNumber << 3) | wireType);
    }
    writeDouble(_value) {
        this.pos += 8;
    }
    writeString(str) {
        const byteLen = utf8ByteLength(str);
        this.pos += estimateVarintSize(byteLen);
        this.pos += byteLen;
    }
}
//# sourceMappingURL=protobuf-size-estimator.js.map