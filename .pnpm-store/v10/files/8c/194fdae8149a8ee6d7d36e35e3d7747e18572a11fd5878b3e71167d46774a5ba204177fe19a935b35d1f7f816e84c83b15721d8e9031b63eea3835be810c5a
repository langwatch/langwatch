import { determineTimestampFormat } from "@smithy/core/protocols";
import { NormalizedSchema } from "@smithy/core/schema";
import { dateToUtcString, generateIdempotencyToken, LazyJsonString, NumericValue, toBase64 } from "@smithy/core/serde";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { JsonBytesStringAdapter } from "./JsonBytesStringAdapter";
const encoder = new TextEncoder();
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22;
const COLON = 0x3a;
const COMMA = 0x2c;
const BACKSLASH = 0x5c;
const TRUE = new Uint8Array([0x74, 0x72, 0x75, 0x65]);
const FALSE = new Uint8Array([0x66, 0x61, 0x6c, 0x73, 0x65]);
const NULL = new Uint8Array([0x6e, 0x75, 0x6c, 0x6c]);
const ESCAPE_TABLE = new Array(128).fill(null);
ESCAPE_TABLE[0x08] = "b";
ESCAPE_TABLE[0x09] = "t";
ESCAPE_TABLE[0x0a] = "n";
ESCAPE_TABLE[0x0c] = "f";
ESCAPE_TABLE[0x0d] = "r";
ESCAPE_TABLE[0x22] = '"';
ESCAPE_TABLE[0x5c] = "\\";
for (let i = 0; i < 0x20; i++) {
    if (ESCAPE_TABLE[i] === null) {
        ESCAPE_TABLE[i] = "u00" + i.toString(16).padStart(2, "0");
    }
}
const INITIAL_BUFFER_SIZE = 2048;
function alloc(size) {
    return JsonBytesStringAdapter.allocUnsafe(size);
}
export class JsonShapeSerializer2 extends SerdeContextConfig {
    settings;
    json;
    i = 0;
    rootSchema;
    rawValue;
    passthrough = false;
    constructor(settings) {
        super();
        this.settings = settings;
        this.json = alloc(INITIAL_BUFFER_SIZE);
    }
    write(schema, value) {
        this.i = 0;
        this.rawValue = value;
        this.rootSchema = NormalizedSchema.of(schema);
        this.passthrough = this.rootSchema.isBlobSchema() || this.rootSchema.isStringSchema();
        if (!this.passthrough) {
            this.writeValue(this.rootSchema, value, undefined);
        }
    }
    writeDiscriminatedDocument(schema, value) {
        this.i = 0;
        this.rootSchema = NormalizedSchema.of(schema);
        const ns = this.rootSchema;
        if (ns.isStructSchema() && value != null && typeof value === "object") {
            this.writeValue(ns, value, undefined);
            const prefix = `"__type":"${ns.getName(true) ?? "Unknown"}",`;
            const z = prefix.length;
            this.ensure(z);
            this.json.copyWithin(1 + z, 1, this.i);
            encoder.encodeInto(prefix, this.json.subarray(1));
            this.i += z;
        }
        else {
            this.writeValue(ns, value, undefined);
        }
    }
    flush() {
        this.rootSchema = undefined;
        const finalPosition = this.i;
        this.i = 0;
        const raw = this.rawValue;
        this.rawValue = undefined;
        if (finalPosition === 0) {
            return raw;
        }
        const result = this.json.subarray(0, finalPosition);
        this.json = alloc(INITIAL_BUFFER_SIZE);
        return result;
    }
    ensure(byteCount) {
        const { i, json } = this;
        if (i + byteCount > json.length) {
            let newSize = json.length * 2;
            while (newSize < i + byteCount) {
                newSize *= 2;
            }
            const next = alloc(newSize);
            next.set(this.json);
            this.json = next;
        }
    }
    writeAscii(s) {
        const z = s.length;
        this.ensure(z);
        let { i, json } = this;
        for (let j = 0; j < z; ++j) {
            json[i] = s.charCodeAt(j);
            i += 1;
        }
        this.i = i;
    }
    writeAsciiQuoted(s) {
        const z = s.length;
        this.ensure(z + 4);
        let { json, i } = this;
        json[i++] = QUOTE;
        for (let j = 0; j < z; ++j) {
            json[i++] = s.charCodeAt(j);
        }
        json[i++] = QUOTE;
        this.i = i;
    }
    writeJsonString(s) {
        this.ensure(s.length * 3 + 2);
        this.json[this.i++] = QUOTE;
        const z = s.length;
        for (let j = 0; j < z; ++j) {
            const c = s.charCodeAt(j);
            if (c > 0x22 && c < 0x5c) {
                this.json[this.i++] = c;
            }
            else if (c < 0x80) {
                const esc = ESCAPE_TABLE[c];
                if (esc !== null) {
                    this.ensure(esc.length + 1);
                    this.json[this.i++] = BACKSLASH;
                    for (let k = 0; k < esc.length; k++) {
                        this.json[this.i++] = esc.charCodeAt(k);
                    }
                }
                else {
                    this.json[this.i++] = c;
                }
            }
            else if (c >= 0xd800 && c <= 0xdbff) {
                const next = j + 1 < z ? s.charCodeAt(j + 1) : 0;
                if (next >= 0xdc00 && next <= 0xdfff) {
                    this.ensure(4);
                    const { written } = encoder.encodeInto(s.substring(j, j + 2), this.json.subarray(this.i));
                    this.i += written;
                    ++j;
                }
                else {
                    this.ensure(6);
                    this.writeUnicodeEscape(c);
                }
            }
            else if (c >= 0xdc00 && c <= 0xdfff) {
                this.ensure(6);
                this.writeUnicodeEscape(c);
            }
            else {
                let { i, json } = this;
                if (c < 0x800) {
                    json[i++] = 0xc0 | (c >> 6);
                    json[i++] = 0x80 | (c & 0x3f);
                }
                else {
                    json[i++] = 0xe0 | (c >> 12);
                    json[i++] = 0x80 | ((c >> 6) & 0x3f);
                    json[i++] = 0x80 | (c & 0x3f);
                }
                this.i = i;
            }
        }
        this.json[this.i++] = QUOTE;
    }
    writeUnicodeEscape(code) {
        let { json, i } = this;
        json[i++] = BACKSLASH;
        json[i++] = 0x75;
        const hex = code.toString(16).padStart(4, "0");
        for (let j = 0; j < 4; ++j) {
            json[i++] = hex.charCodeAt(j);
        }
        this.i = i;
    }
    static B64 = (() => {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const table = new Uint8Array(64);
        for (let i = 0; i < 64; ++i) {
            table[i] = chars.charCodeAt(i);
        }
        return table;
    })();
    writeBase64(data) {
        const b64Len = Math.ceil(data.length / 3) * 4;
        this.ensure(b64Len + 2);
        const json = this.json;
        const B64 = JsonShapeSerializer2.B64;
        let i = this.i;
        json[i++] = QUOTE;
        const len = data.length;
        const remainder = len % 3;
        const mainLen = len - remainder;
        for (let j = 0; j < mainLen; j += 3) {
            const a = data[j];
            const b = data[j + 1];
            const c = data[j + 2];
            json[i++] = B64[a >> 2];
            json[i++] = B64[((a & 0x03) << 4) | (b >> 4)];
            json[i++] = B64[((b & 0x0f) << 2) | (c >> 6)];
            json[i++] = B64[c & 0x3f];
        }
        if (remainder === 2) {
            const a = data[mainLen];
            const b = data[mainLen + 1];
            json[i++] = B64[a >> 2];
            json[i++] = B64[((a & 0x03) << 4) | (b >> 4)];
            json[i++] = B64[(b & 0x0f) << 2];
            json[i++] = 0x3d;
        }
        else if (remainder === 1) {
            const a = data[mainLen];
            json[i++] = B64[a >> 2];
            json[i++] = B64[(a & 0x03) << 4];
            json[i++] = 0x3d;
            json[i++] = 0x3d;
        }
        json[i++] = QUOTE;
        this.i = i;
    }
    writeValue(schema, value, container) {
        if (value == null) {
            if (container?.isStructSchema()) {
                if (value === undefined) {
                    const ns = NormalizedSchema.of(schema);
                    if (ns.isIdempotencyToken()) {
                        this.writeAsciiQuoted(generateIdempotencyToken());
                        return;
                    }
                }
                return;
            }
            this.ensure(4);
            this.json.set(NULL, this.i);
            this.i += 4;
            return;
        }
        const ns = NormalizedSchema.of(schema);
        const isObject = typeof value === "object";
        if (ns.isStringSchema()) {
            const mediaType = ns.getMergedTraits().mediaType;
            if (mediaType) {
                const isJson = mediaType === "application/json" || mediaType.endsWith("+json");
                if (isJson) {
                    this.writeJsonString(LazyJsonString.from(value).toString());
                    return;
                }
            }
        }
        if (isObject) {
            if (ns.isStructSchema()) {
                this.writeStruct(ns, value);
                return;
            }
            if (Array.isArray(value) && (ns.isListSchema() || ns.isDocumentSchema())) {
                this.writeList(ns, value, ns.isDocumentSchema());
                return;
            }
            if (ns.isMapSchema()) {
                this.writeMap(ns, value, false);
                return;
            }
            if (value instanceof Uint8Array && (ns.isBlobSchema() || ns.isDocumentSchema())) {
                this.writeBase64(value);
                return;
            }
            if (value instanceof Date && (ns.isTimestampSchema() || ns.isDocumentSchema())) {
                this.writeTimestamp(ns, value);
                return;
            }
            if (value instanceof NumericValue) {
                this.writeAscii(value.string);
                return;
            }
            if (ns.isDocumentSchema()) {
                if (Array.isArray(value)) {
                    this.writeList(ns, value, true);
                }
                else {
                    this.writeMap(ns, value, true);
                }
                return;
            }
            const json = JSON.stringify(value);
            this.writeAscii(json);
            return;
        }
        if (typeof value === "string") {
            if (ns.isBlobSchema()) {
                const b64 = (this.serdeContext?.base64Encoder ?? toBase64)(value);
                this.writeAsciiQuoted(b64);
                return;
            }
            this.writeJsonString(value);
            return;
        }
        if (typeof value === "number") {
            if (Math.abs(value) === Infinity || Number.isNaN(value)) {
                this.writeAsciiQuoted(String(value));
                return;
            }
            const numStr = String(value);
            this.writeAscii(numStr);
            return;
        }
        if (typeof value === "boolean") {
            this.ensure(5);
            let { i, json } = this;
            if (value) {
                json.set(TRUE, i);
                i += 4;
            }
            else {
                json.set(FALSE, i);
                i += 5;
            }
            this.i = i;
            return;
        }
        if (typeof value === "bigint") {
            this.writeAscii(value.toString());
            return;
        }
        this.writeAscii(String(value));
    }
    writeStruct(ns, value) {
        this.ensure(2);
        this.json[this.i++] = OPEN_BRACE;
        let wroteAny = false;
        const hasType = typeof value.__type === "string";
        let writtenKeys;
        if (hasType) {
            writtenKeys = new Set();
        }
        for (const [memberName, memberSchema] of ns.structIterator()) {
            const item = value[memberName];
            if (item == null && !memberSchema.isIdempotencyToken()) {
                continue;
            }
            if (wroteAny) {
                this.ensure(1);
                this.json[this.i++] = COMMA;
            }
            wroteAny = true;
            const targetKey = this.settings.jsonName ? (memberSchema.getMergedTraits().jsonName ?? memberName) : memberName;
            if (writtenKeys) {
                writtenKeys.add(memberName);
                writtenKeys.add(targetKey);
            }
            this.writeAsciiQuoted(targetKey);
            this.json[this.i++] = COLON;
            this.writeValue(memberSchema, item, ns);
        }
        if (!wroteAny && ns.isUnionSchema()) {
            const { $unknown } = value;
            if (Array.isArray($unknown)) {
                const [k, v] = $unknown;
                this.writeAsciiQuoted(k);
                this.ensure(1);
                this.json[this.i++] = COLON;
                this.writeValue(15, v, ns);
            }
        }
        else if (hasType) {
            for (const k in value) {
                if (writtenKeys.has(k)) {
                    continue;
                }
                writtenKeys.add(k);
                const v = value[k];
                if (wroteAny) {
                    this.ensure(1);
                    this.json[this.i++] = COMMA;
                }
                wroteAny = true;
                this.writeAsciiQuoted(k);
                this.ensure(1);
                this.json[this.i++] = COLON;
                this.writeValue(15, v, undefined);
            }
        }
        this.ensure(1);
        this.json[this.i++] = CLOSE_BRACE;
    }
    writeList(ns, value, isDocument) {
        const sparse = !!ns.getMergedTraits().sparse;
        const valueSchema = ns.getValueSchema();
        if (!isDocument) {
            if (valueSchema.isStringSchema() || valueSchema.isNumericSchema() || valueSchema.isBooleanSchema()) {
                let hasSpecials = false;
                for (let i = 0; i < value.length; ++i) {
                    const v = value[i];
                    if (Number.isNaN(v) || v === Infinity || v === -Infinity || (v == null && !sparse)) {
                        hasSpecials = true;
                        break;
                    }
                }
                let json;
                if (!hasSpecials) {
                    json = JSON.stringify(value);
                }
                else {
                    const out = [];
                    for (let i = 0; i < value.length; ++i) {
                        const v = value[i];
                        if (v == null && !sparse)
                            continue;
                        if (Number.isNaN(v) || v === Infinity || v === -Infinity) {
                            out.push(String(v));
                        }
                        else {
                            out.push(v);
                        }
                    }
                    json = JSON.stringify(out);
                }
                this.ensure(json.length * 3);
                this.i += encoder.encodeInto(json, this.json.subarray(this.i)).written;
                return;
            }
        }
        this.ensure(2);
        this.json[this.i++] = OPEN_BRACKET;
        let wroteFirstItem = false;
        for (let i = 0; i < value.length; ++i) {
            const item = value[i];
            if (isDocument ? item === undefined : item == null && !sparse) {
                continue;
            }
            if (wroteFirstItem) {
                this.ensure(1);
                this.json[this.i++] = COMMA;
            }
            this.writeValue(valueSchema, item, undefined);
            wroteFirstItem = true;
        }
        this.ensure(1);
        this.json[this.i++] = CLOSE_BRACKET;
    }
    writeMap(ns, value, isDocument) {
        const sparse = !!ns.getMergedTraits().sparse;
        const valueSchema = ns.getValueSchema();
        if (!isDocument) {
            if (valueSchema.isStringSchema() || valueSchema.isNumericSchema() || valueSchema.isBooleanSchema()) {
                let modifications;
                for (const k in value) {
                    const v = value[k];
                    if (Number.isNaN(v) || v === Infinity || v === -Infinity) {
                        (modifications ??= {})[k] = v;
                        value[k] = String(v);
                    }
                    else if (v === null && !sparse) {
                        (modifications ??= {})[k] = null;
                        value[k] = undefined;
                    }
                }
                const json = JSON.stringify(value);
                if (modifications) {
                    Object.assign(value, modifications);
                }
                this.ensure(json.length * 3);
                this.i += encoder.encodeInto(json, this.json.subarray(this.i)).written;
                return;
            }
        }
        this.ensure(2);
        this.json[this.i++] = OPEN_BRACE;
        let first = true;
        for (const k in value) {
            const v = value[k];
            if (isDocument ? v === undefined : v == null && !sparse) {
                continue;
            }
            if (!first) {
                this.ensure(1);
                this.json[this.i++] = COMMA;
            }
            first = false;
            this.writeJsonString(k);
            this.ensure(1);
            this.json[this.i++] = COLON;
            this.writeValue(valueSchema, v, undefined);
        }
        this.ensure(1);
        this.json[this.i++] = CLOSE_BRACE;
    }
    writeTimestamp(ns, value) {
        const format = determineTimestampFormat(ns, this.settings);
        switch (format) {
            case 5: {
                const iso = value.toISOString().replace(".000Z", "Z");
                this.writeAsciiQuoted(iso);
                return;
            }
            case 6: {
                this.writeAsciiQuoted(dateToUtcString(value));
                return;
            }
            case 7: {
                const epochSecs = String(value.getTime() / 1000);
                this.writeAscii(epochSecs);
                return;
            }
            default: {
                const epochSecs = String(value.getTime() / 1000);
                this.writeAscii(epochSecs);
                return;
            }
        }
    }
}
