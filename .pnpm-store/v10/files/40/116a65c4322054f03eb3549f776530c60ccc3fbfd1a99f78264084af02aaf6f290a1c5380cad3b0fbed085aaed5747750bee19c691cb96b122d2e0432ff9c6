import { determineTimestampFormat } from "@smithy/core/protocols";
import { NormalizedSchema } from "@smithy/core/schema";
import { fromBase64, LazyJsonString, NumericValue, parseEpochTimestamp, parseRfc3339DateTimeWithOffset, parseRfc7231DateTime, } from "@smithy/core/serde";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { UnionSerde } from "../../UnionSerde";
import { detectBufferParsing } from "../detectBufferParsing";
import { jsonReviver } from "../jsonReviver";
import { needsReviver } from "../needsReviver";
import { parseJsonBody } from "../parseJsonBody";
import { writeKey } from "../../writeKey";
export class JsonShapeDeserializer2 extends SerdeContextConfig {
    settings;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    async read(schema, data) {
        const reviver = needsReviver(schema) ? jsonReviver : undefined;
        let parsed;
        if (typeof data === "string") {
            if (data.length === 0) {
                return {};
            }
            parsed = JSON.parse(data, reviver);
        }
        else if (data instanceof Uint8Array && detectBufferParsing()) {
            if (data.byteLength === 0) {
                return {};
            }
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
            parsed = JSON.parse(buf, reviver);
        }
        else {
            parsed = await parseJsonBody(data, this.serdeContext, schema);
        }
        return this._read(schema, parsed);
    }
    readObject(schema, data) {
        return this._read(schema, data);
    }
    _read(schema, value) {
        const isObject = value !== null && typeof value === "object";
        const ns = NormalizedSchema.of(schema);
        if (isObject) {
            if (ns.isStructSchema()) {
                return this._readStruct(ns, value);
            }
            if (Array.isArray(value) && ns.isListSchema()) {
                const listMember = ns.getValueSchema();
                if (this.needsTransform(listMember)) {
                    for (let i = 0; i < value.length; ++i) {
                        value[i] = this._read(listMember, value[i]);
                    }
                }
                return value;
            }
            if (ns.isMapSchema()) {
                const mapMember = ns.getValueSchema();
                const map = value;
                if (this.needsTransform(mapMember)) {
                    for (const k in map) {
                        if (k === "__proto__") {
                            writeKey(map);
                        }
                        map[k] = this._read(mapMember, map[k]);
                    }
                }
                return map;
            }
        }
        if (ns.isBlobSchema() && typeof value === "string") {
            return fromBase64(value);
        }
        const mediaType = ns.getMergedTraits().mediaType;
        if (ns.isStringSchema() && typeof value === "string" && mediaType) {
            const isJson = mediaType === "application/json" || mediaType.endsWith("+json");
            if (isJson) {
                return LazyJsonString.from(value);
            }
            return value;
        }
        if (ns.isTimestampSchema() && value != null) {
            const format = determineTimestampFormat(ns, this.settings);
            switch (format) {
                case 5:
                    return parseRfc3339DateTimeWithOffset(value);
                case 6:
                    return parseRfc7231DateTime(value);
                case 7:
                    return parseEpochTimestamp(value);
                default:
                    console.warn("Missing timestamp format, parsing value with Date constructor:", value);
                    return new Date(value);
            }
        }
        if (ns.isBigIntegerSchema() && (typeof value === "number" || typeof value === "string")) {
            return BigInt(value);
        }
        if (ns.isBigDecimalSchema() && value != undefined) {
            if (value instanceof NumericValue) {
                return value;
            }
            const untyped = value;
            if (untyped.type === "bigDecimal" && "string" in untyped) {
                return new NumericValue(untyped.string, untyped.type);
            }
            return new NumericValue(String(value), "bigDecimal");
        }
        if (ns.isNumericSchema() && typeof value === "string") {
            switch (value) {
                case "Infinity":
                    return Infinity;
                case "-Infinity":
                    return -Infinity;
                case "NaN":
                    return NaN;
            }
            return value;
        }
        if (ns.isDocumentSchema()) {
            if (isObject) {
                if (Array.isArray(value)) {
                    for (let i = 0; i < value.length; ++i) {
                        const v = value[i];
                        if (!(v instanceof NumericValue)) {
                            value[i] = this._read(ns, v);
                        }
                    }
                }
                else {
                    const doc = value;
                    for (const k in doc) {
                        if (k === "__proto__") {
                            writeKey(doc);
                        }
                        const v = doc[k];
                        if (!(v instanceof NumericValue)) {
                            doc[k] = this._read(ns, v);
                        }
                    }
                }
            }
        }
        return value;
    }
    _readStruct(ns, record) {
        const union = ns.isUnionSchema();
        const out = {};
        let nameMap;
        const hasType = typeof record.__type === "string";
        const { jsonName } = this.settings;
        if (jsonName && hasType) {
            nameMap = {};
        }
        let unionSerde;
        if (union) {
            unionSerde = new UnionSerde(record, out);
        }
        for (const [memberName, memberSchema] of ns.structIterator()) {
            let fromKey = memberName;
            if (jsonName) {
                fromKey = memberSchema.getMergedTraits().jsonName ?? fromKey;
                if (hasType) {
                    nameMap[fromKey] = memberName;
                }
            }
            if (union) {
                unionSerde.mark(fromKey);
            }
            if (record[fromKey] != null) {
                out[memberName] = this._read(memberSchema, record[fromKey]);
            }
        }
        if (union) {
            unionSerde.writeUnknown();
        }
        else if (hasType) {
            for (const k in record) {
                const v = record[k];
                const t = jsonName ? (nameMap[k] ?? k) : k;
                if (!(t in out)) {
                    out[t] = v;
                }
            }
        }
        return out;
    }
    needsTransform(ns) {
        if (ns.isBlobSchema() || ns.isTimestampSchema() || ns.isBigIntegerSchema() || ns.isBigDecimalSchema()) {
            return true;
        }
        if (ns.isDocumentSchema() || ns.isStructSchema() || ns.isListSchema() || ns.isMapSchema()) {
            return true;
        }
        if (ns.isStringSchema() && ns.getMergedTraits().mediaType) {
            return true;
        }
        return false;
    }
}
