"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtobufReader = void 0;
/**
 * Minimal binary protobuf reader.
 * Only implements the wire-types that we currently need; this is not intended
 * to be a general-purpose protobuf reader.
 *
 * Since the values we parse are generally small and not very nested, it's public
 * interface does not enforce the same low-allocation philosophy that ProtobufWriter does.
 * If this is needed in the future, we should refactor this to fit the use-case.
 */
class ProtobufReader {
    pos = 0;
    _buf;
    _textDecoder;
    constructor(buf) {
        this._buf = buf;
        this._textDecoder = new TextDecoder();
    }
    isAtEnd() {
        return this.pos >= this._buf.length;
    }
    /** Read a varint and decode it as a tag, returning field number and wire type. */
    readTag() {
        const raw = this.readVarint();
        return { fieldNumber: raw >>> 3, wireType: raw & 0x7 };
    }
    /**
     * Read a base-128 varint.
     * Returns a JS `number`; precision above 2^53 is silently lost.
     * Throws if the buffer is truncated mid-varint.
     */
    readVarint() {
        let result = 0;
        let shift = 0;
        let terminated = false;
        while (this.pos < this._buf.length) {
            const b = this._buf[this.pos++];
            result += (b & 0x7f) * Math.pow(2, shift);
            shift += 7;
            if ((b & 0x80) === 0) {
                terminated = true;
                break;
            }
        }
        if (!terminated) {
            throw new Error('Truncated buffer: unexpected end of data while reading varint');
        }
        return result;
    }
    /** Read a length-delimited byte sequence (bytes field or embedded message). */
    readBytes() {
        const len = this.readVarint();
        if (this.pos + len > this._buf.length) {
            throw new Error(`Truncated buffer: expected ${len} bytes at position ${this.pos}, but only ${this._buf.length - this.pos} available`);
        }
        const slice = this._buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return slice;
    }
    /** Read a length-delimited UTF-8 string. */
    readString() {
        return this._textDecoder.decode(this.readBytes());
    }
    /**
     * Skip an unknown field.
     * Handles wire types 0 (varint), 1 (64-bit), 2 (length-delimited),
     * and 5 (32-bit).
     *
     * Wire types 3 and 4 (start-group / end-group) are deprecated in proto3
     * and are not used by any OpenTelemetry proto definition. Encountering
     * them is treated as an error.
     */
    skip(wireType) {
        switch (wireType) {
            case 0: // varint
                this.readVarint();
                break;
            case 1: // 64-bit fixed
                this.pos += 8;
                break;
            case 2: // length-delimited
                this.readBytes();
                break;
            case 5: // 32-bit fixed
                this.pos += 4;
                break;
            default:
                throw new Error(`Unknown wire type ${wireType}, cannot safely skip`);
        }
    }
}
exports.ProtobufReader = ProtobufReader;
//# sourceMappingURL=protobuf-reader.js.map