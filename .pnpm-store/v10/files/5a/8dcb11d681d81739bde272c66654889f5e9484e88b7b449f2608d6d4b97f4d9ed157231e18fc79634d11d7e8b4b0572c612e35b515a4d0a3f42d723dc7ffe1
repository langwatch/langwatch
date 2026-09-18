const { SmithyRpcV2CborProtocol, loadSmithyRpcV2CborErrorCode } = require("@smithy/core/cbor");
const { TypeRegistry, NormalizedSchema, deref } = require("@smithy/core/schema");
const { decorateServiceException, getValueFromTextNode } = require("@smithy/core/client");
const { collectBody, determineTimestampFormat, RpcProtocol, HttpBindingProtocol, HttpInterceptingShapeSerializer, HttpInterceptingShapeDeserializer, FromStringShapeDeserializer, extendedEncodeURIComponent } = require("@smithy/core/protocols");
const { NumericValue, toUtf8, fromBase64, LazyJsonString, parseEpochTimestamp, parseRfc7231DateTime, parseRfc3339DateTimeWithOffset, generateIdempotencyToken, toBase64, dateToUtcString, expectUnion } = require("@smithy/core/serde");
const { parseXML, XmlNode, XmlText } = require("@aws-sdk/xml-builder");

class ProtocolLib {
    queryCompat;
    errorRegistry;
    constructor(queryCompat = false) {
        this.queryCompat = queryCompat;
    }
    resolveRestContentType(defaultContentType, inputSchema) {
        const members = inputSchema.getMemberSchemas();
        const httpPayloadMember = Object.values(members).find((m) => {
            return !!m.getMergedTraits().httpPayload;
        });
        if (httpPayloadMember) {
            const mediaType = httpPayloadMember.getMergedTraits().mediaType;
            if (mediaType) {
                return mediaType;
            }
            else if (httpPayloadMember.isStringSchema()) {
                return "text/plain";
            }
            else if (httpPayloadMember.isBlobSchema()) {
                return "application/octet-stream";
            }
            else {
                return defaultContentType;
            }
        }
        else if (!inputSchema.isUnitSchema()) {
            const hasBody = Object.values(members).find((m) => {
                const { httpQuery, httpQueryParams, httpHeader, httpLabel, httpPrefixHeaders } = m.getMergedTraits();
                const noPrefixHeaders = httpPrefixHeaders === void 0;
                return !httpQuery && !httpQueryParams && !httpHeader && !httpLabel && noPrefixHeaders;
            });
            if (hasBody) {
                return defaultContentType;
            }
        }
    }
    async getErrorSchemaOrThrowBaseException(errorIdentifier, defaultNamespace, response, dataObject, metadata, getErrorSchema) {
        let errorName = errorIdentifier;
        if (errorIdentifier.includes("#")) {
            [, errorName] = errorIdentifier.split("#");
        }
        const errorMetadata = {
            $metadata: metadata,
            $fault: response.statusCode < 500 ? "client" : "server",
        };
        if (!this.errorRegistry) {
            throw new Error("@aws-sdk/core/protocols - error handler not initialized.");
        }
        try {
            const errorSchema = getErrorSchema?.(this.errorRegistry, errorName) ??
                this.errorRegistry.getSchema(errorIdentifier);
            return { errorSchema, errorMetadata };
        }
        catch (e) {
            dataObject.message = dataObject.message ?? dataObject.Message ?? "UnknownError";
            const synthetic = this.errorRegistry;
            const baseExceptionSchema = synthetic.getBaseException();
            if (baseExceptionSchema) {
                const ErrorCtor = synthetic.getErrorCtor(baseExceptionSchema) ?? Error;
                throw this.decorateServiceException(Object.assign(new ErrorCtor({ name: errorName }), errorMetadata), dataObject);
            }
            const d = dataObject;
            const message = d?.message ?? d?.Message ?? d?.Error?.Message ?? d?.Error?.message;
            throw this.decorateServiceException(Object.assign(new Error(message), {
                name: errorName,
            }, errorMetadata), dataObject);
        }
    }
    compose(composite, errorIdentifier, defaultNamespace) {
        let namespace = defaultNamespace;
        if (errorIdentifier.includes("#")) {
            [namespace] = errorIdentifier.split("#");
        }
        const staticRegistry = TypeRegistry.for(namespace);
        const defaultSyntheticRegistry = TypeRegistry.for("smithy.ts.sdk.synthetic." + defaultNamespace);
        composite.copyFrom(staticRegistry);
        composite.copyFrom(defaultSyntheticRegistry);
        this.errorRegistry = composite;
    }
    decorateServiceException(exception, additions = {}) {
        if (this.queryCompat) {
            const msg = exception.Message ?? additions.Message;
            const error = decorateServiceException(exception, additions);
            if (msg) {
                error.message = msg;
            }
            const errorObj = error.Error ?? {};
            errorObj.Type = error.Error?.Type;
            errorObj.Code = error.Error?.Code;
            errorObj.Message = error.Error?.message ?? error.Error?.Message ?? msg;
            error.Error = errorObj;
            const reqId = error.$metadata.requestId;
            if (reqId) {
                error.RequestId = reqId;
            }
            return error;
        }
        return decorateServiceException(exception, additions);
    }
    setQueryCompatError(output, response) {
        const queryErrorHeader = response.headers?.["x-amzn-query-error"];
        if (output !== undefined && queryErrorHeader != null) {
            const [Code, Type] = queryErrorHeader.split(";");
            const keys = Object.keys(output);
            const Error = {
                Code,
                Type,
            };
            output.Code = Code;
            output.Type = Type;
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                Error[k === "message" ? "Message" : k] = output[k];
            }
            delete Error.__type;
            output.Error = Error;
        }
    }
    queryCompatOutput(queryCompatErrorData, errorData) {
        if (queryCompatErrorData.Error) {
            errorData.Error = queryCompatErrorData.Error;
        }
        if (queryCompatErrorData.Type) {
            errorData.Type = queryCompatErrorData.Type;
        }
        if (queryCompatErrorData.Code) {
            errorData.Code = queryCompatErrorData.Code;
        }
    }
    findQueryCompatibleError(registry, errorName) {
        try {
            return registry.getSchema(errorName);
        }
        catch (e) {
            return registry.find((schema) => NormalizedSchema.of(schema).getMergedTraits().awsQueryError?.[0] === errorName);
        }
    }
}

class AwsSmithyRpcV2CborProtocol extends SmithyRpcV2CborProtocol {
    awsQueryCompatible;
    mixin;
    constructor({ defaultNamespace, errorTypeRegistries, awsQueryCompatible, }) {
        super({ defaultNamespace, errorTypeRegistries });
        this.awsQueryCompatible = !!awsQueryCompatible;
        this.mixin = new ProtocolLib(this.awsQueryCompatible);
    }
    async serializeRequest(operationSchema, input, context) {
        const request = await super.serializeRequest(operationSchema, input, context);
        if (this.awsQueryCompatible) {
            request.headers["x-amzn-query-mode"] = "true";
        }
        return request;
    }
    async handleError(operationSchema, context, response, dataObject, metadata) {
        if (this.awsQueryCompatible) {
            this.mixin.setQueryCompatError(dataObject, response);
        }
        const errorName = (() => {
            const compatHeader = response.headers["x-amzn-query-error"];
            if (compatHeader && this.awsQueryCompatible) {
                return compatHeader.split(";")[0];
            }
            return loadSmithyRpcV2CborErrorCode(response, dataObject) ?? "Unknown";
        })();
        this.mixin.compose(this.compositeErrorRegistry, errorName, this.options.defaultNamespace);
        const { errorSchema, errorMetadata } = await this.mixin.getErrorSchemaOrThrowBaseException(errorName, this.options.defaultNamespace, response, dataObject, metadata, this.awsQueryCompatible ? this.mixin.findQueryCompatibleError : undefined);
        const ns = NormalizedSchema.of(errorSchema);
        const message = dataObject.message ?? dataObject.Message ?? "UnknownError";
        const ErrorCtor = this.compositeErrorRegistry.getErrorCtor(errorSchema) ?? Error;
        const exception = new ErrorCtor({});
        const output = {};
        for (const [name, member] of ns.structIterator()) {
            if (dataObject[name] != null) {
                output[name] = this.deserializer.readValue(member, dataObject[name]);
            }
        }
        if (this.awsQueryCompatible) {
            this.mixin.queryCompatOutput(dataObject, output);
        }
        throw this.mixin.decorateServiceException(Object.assign(exception, errorMetadata, {
            $fault: ns.getMergedTraits().error,
            message,
        }, output), dataObject);
    }
}

class SerdeContextConfig {
    serdeContext;
    setSerdeContext(serdeContext) {
        this.serdeContext = serdeContext;
    }
}

class UnionSerde {
    from;
    to;
    keys;
    constructor(from, to) {
        this.from = from;
        this.to = to;
        const keys = Object.keys(this.from);
        const set = new Set(keys);
        set.delete("__type");
        this.keys = set;
    }
    mark(key) {
        this.keys.delete(key);
    }
    hasUnknown() {
        return this.keys.size === 1 && Object.keys(this.to).length === 0;
    }
    writeUnknown() {
        if (this.hasUnknown()) {
            const k = this.keys.values().next().value;
            const v = this.from[k];
            this.to.$unknown = [k, v];
        }
    }
}

let canParseBuffer;
function detectBufferParsing() {
    if (canParseBuffer === undefined) {
        try {
            if (typeof Buffer !== "function") {
                canParseBuffer = false;
            }
            else {
                const result = JSON.parse(Buffer.from([0x7b, 0x7d]));
                canParseBuffer = result !== null && typeof result === "object";
            }
        }
        catch {
            canParseBuffer = false;
        }
    }
    return canParseBuffer;
}

function jsonReviver(key, value, context) {
    if (context?.source) {
        const numericString = context.source;
        if (typeof value === "number") {
            const inSafeRange = value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER;
            if (inSafeRange) {
                if (isRepresentable(numericString, value)) {
                    return value;
                }
                return new NumericValue(numericString, "bigDecimal");
            }
            else {
                if (isFractionalBigNumeric(numericString)) {
                    return new NumericValue(numericString, "bigDecimal");
                }
                if (/[eE]/.test(numericString)) {
                    return expandExponentToBigInt(numericString);
                }
                return BigInt(numericString);
            }
        }
    }
    return value;
}
function isFractionalBigNumeric(s) {
    const dotIndex = s.indexOf(".");
    if (dotIndex === -1) {
        return false;
    }
    const eIndex = s.search(/[eE]/);
    if (eIndex === -1) {
        return true;
    }
    const fracDigits = eIndex - dotIndex - 1;
    const exp = parseInt(s.slice(eIndex + 1), 10);
    return exp < fracDigits;
}
function isRepresentable(numericString, value) {
    if (numericString === String(value)) {
        return true;
    }
    if (Object.is(value, -0)) {
        return true;
    }
    if (/[eE]/.test(numericString)) {
        return expandToDecimal(numericString) === expandToDecimal(String(value));
    }
    const normalized = numericString.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    const canonical = String(value);
    if (normalized === canonical) {
        return true;
    }
    if (/[eE]/.test(canonical)) {
        return normalized === expandToDecimal(canonical);
    }
    return false;
}
function expandToDecimal(s) {
    const negative = s.startsWith("-");
    const abs = negative ? s.slice(1) : s;
    const eIndex = abs.search(/[eE]/);
    let result;
    if (eIndex === -1) {
        result = abs;
    }
    else {
        const exp = parseInt(abs.slice(eIndex + 1), 10);
        const mantissa = abs.slice(0, eIndex);
        const dotIndex = mantissa.indexOf(".");
        let digits;
        let intLen;
        if (dotIndex === -1) {
            digits = mantissa;
            intLen = mantissa.length;
        }
        else {
            digits = mantissa.slice(0, dotIndex) + mantissa.slice(dotIndex + 1);
            intLen = dotIndex;
        }
        digits = digits.replace(/0+$/, "") || "0";
        const newDotPos = intLen + exp;
        if (digits === "0") {
            result = "0";
        }
        else if (newDotPos <= 0) {
            result = "0." + "0".repeat(-newDotPos) + digits;
        }
        else if (newDotPos >= digits.length) {
            result = digits + "0".repeat(newDotPos - digits.length);
        }
        else {
            result = digits.slice(0, newDotPos) + "." + digits.slice(newDotPos);
        }
    }
    if (result.includes(".")) {
        result = result.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }
    return (negative ? "-" : "") + result;
}
function expandExponentToBigInt(s) {
    const eIndex = s.search(/[eE]/);
    const exp = parseInt(s.slice(eIndex + 1), 10);
    const negative = s.startsWith("-");
    const mantissa = s.slice(negative ? 1 : 0, eIndex);
    const dotIndex = mantissa.indexOf(".");
    let digits;
    let shift;
    if (dotIndex === -1) {
        digits = mantissa;
        shift = exp;
    }
    else {
        digits = mantissa.slice(0, dotIndex) + mantissa.slice(dotIndex + 1);
        const fracDigits = mantissa.length - dotIndex - 1;
        shift = exp - fracDigits;
    }
    digits = digits.replace(/0+$/, "") || "0";
    const result = BigInt(digits) * 10n ** BigInt(shift + (mantissa.replace(".", "").length - digits.length));
    return negative ? -result : result;
}

const REVIVER_SYMBOL = Symbol.for("@aws-sdk/reviver");
function needsReviver(schema) {
    const ns = NormalizedSchema.of(schema);
    const raw = ns.getSchema();
    if (Array.isArray(raw) && ns.isStructSchema()) {
        if (REVIVER_SYMBOL in raw) {
            return raw[REVIVER_SYMBOL];
        }
        const result = _check(ns, new Set());
        raw[REVIVER_SYMBOL] = result;
        return result;
    }
    return _check(ns, new Set());
}
function _check(ns, seen) {
    const raw = ns.getSchema();
    if (seen.has(raw)) {
        return false;
    }
    seen.add(raw);
    if (ns.isBigIntegerSchema() || ns.isBigDecimalSchema()) {
        return true;
    }
    if (ns.isStructSchema()) {
        for (const [, memberSchema] of ns.structIterator()) {
            if (_check(memberSchema, seen)) {
                return true;
            }
        }
    }
    else if (ns.isListSchema() || ns.isMapSchema()) {
        if (_check(ns.getValueSchema(), seen)) {
            return true;
        }
    }
    else if (ns.isDocumentSchema()) {
        return true;
    }
    return false;
}

const collectBodyString = (streamBody, context) => collectBody(streamBody, context).then((body) => (context?.utf8Encoder ?? toUtf8)(body));

async function parseJsonBody(streamBody, context, schema) {
    let parsingInput;
    if (detectBufferParsing() && typeof streamBody?.[Symbol.asyncIterator] === "function") {
        const buffer = await collectBody(streamBody, context);
        if (typeof Buffer === "function") {
            if (Buffer.isBuffer(buffer)) {
                parsingInput = buffer;
            }
            else {
                parsingInput = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            }
        }
    }
    if (!parsingInput) {
        parsingInput = await collectBodyString(streamBody, context);
    }
    if (parsingInput.length === 0) {
        return {};
    }
    const reviver = schema && needsReviver(schema) ? jsonReviver : undefined;
    try {
        return JSON.parse(parsingInput, reviver);
    }
    catch (e) {
        if (e?.name === "SyntaxError") {
            Object.defineProperty(e, "$responseBodyText", {
                value: typeof parsingInput === "string" ? parsingInput : parsingInput.toString("utf8"),
            });
        }
        throw e;
    }
}
const parseJsonErrorBody = async (errorBody, context) => {
    const value = await parseJsonBody(errorBody, context);
    value.message = value.message ?? value.Message;
    return value;
};
const findKey = (object, key) => Object.keys(object).find((k) => k.toLowerCase() === key.toLowerCase());
const sanitizeErrorCode = (rawValue) => {
    let cleanValue = rawValue;
    if (typeof cleanValue === "number") {
        cleanValue = cleanValue.toString();
    }
    if (cleanValue.indexOf(",") >= 0) {
        cleanValue = cleanValue.split(",")[0];
    }
    if (cleanValue.indexOf(":") >= 0) {
        cleanValue = cleanValue.split(":")[0];
    }
    if (cleanValue.indexOf("#") >= 0) {
        cleanValue = cleanValue.split("#")[1];
    }
    return cleanValue;
};
const loadRestJsonErrorCode = (output, data) => {
    return loadErrorCode(output, data, ["header", "code", "type"]);
};
const loadJsonRpcErrorCode = (output, data, queryCompat = false) => {
    return loadErrorCode(output, data, queryCompat ? ["code", "header", "type"] : ["type", "code", "header"]);
};
const loadErrorCode = ({ headers }, data, order) => {
    while (order.length > 0) {
        const location = order.shift();
        switch (location) {
            case "header":
                const headerKey = findKey(headers ?? {}, "x-amzn-errortype");
                if (headerKey !== undefined) {
                    return sanitizeErrorCode(headers[headerKey]);
                }
                break;
            case "code":
                const codeKey = findKey(data ?? {}, "code");
                if (codeKey && data[codeKey] !== undefined) {
                    return sanitizeErrorCode(data[codeKey]);
                }
                break;
            case "type":
                if (data?.__type !== undefined) {
                    return sanitizeErrorCode(data.__type);
                }
                break;
        }
    }
};

function writeKey(obj) {
    Object.defineProperty(obj, "__proto__", { value: undefined, writable: true, enumerable: true, configurable: true });
}

class JsonShapeDeserializer2 extends SerdeContextConfig {
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

class JsonBytesStringAdapter extends Uint8Array {
    string = null;
    static allocUnsafe(bytes) {
        if (typeof Buffer === "function") {
            const buffer = Buffer.allocUnsafe(bytes);
            return new JsonBytesStringAdapter(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        }
        return new JsonBytesStringAdapter(bytes);
    }
    toString() {
        return this.s();
    }
    valueOf() {
        return this.s();
    }
    includes(searchString, position) {
        if (typeof searchString === "string") {
            return this.s().includes(searchString, position);
        }
        return Uint8Array.prototype.includes.call(this, searchString, position);
    }
    indexOf(searchString, position) {
        if (typeof searchString === "string") {
            return this.s().indexOf(searchString, position);
        }
        return Uint8Array.prototype.indexOf.call(this, searchString, position);
    }
    lastIndexOf(searchString, position) {
        if (typeof searchString === "string") {
            return this.s().lastIndexOf(searchString, position);
        }
        const fn = Uint8Array.prototype.lastIndexOf;
        if (position !== undefined) {
            return fn.call(this, searchString, position);
        }
        return fn.call(this, searchString);
    }
    startsWith(searchString, position) {
        return this.s().startsWith(searchString, position);
    }
    endsWith(searchString, endPosition) {
        return this.s().endsWith(searchString, endPosition);
    }
    match(regexp) {
        return this.s().match(regexp);
    }
    replace(searchValue, replaceValue) {
        return this.s().replace(searchValue, replaceValue);
    }
    search(regexp) {
        return this.s().search(regexp);
    }
    split(separator, limit) {
        return this.s().split(separator, limit);
    }
    substring(start, end) {
        return this.s().substring(start, end);
    }
    trim() {
        return this.s().trim();
    }
    trimStart() {
        return this.s().trimStart();
    }
    trimEnd() {
        return this.s().trimEnd();
    }
    charAt(pos) {
        return this.s().charAt(pos);
    }
    charCodeAt(index) {
        return this.s().charCodeAt(index);
    }
    padStart(maxLength, fillString) {
        return this.s().padStart(maxLength, fillString);
    }
    padEnd(maxLength, fillString) {
        return this.s().padEnd(maxLength, fillString);
    }
    repeat(count) {
        return this.s().repeat(count);
    }
    toUpperCase() {
        return this.s().toUpperCase();
    }
    toLowerCase() {
        return this.s().toLowerCase();
    }
    s() {
        if (this.string == null) {
            const n = Date.now();
            if (n > warned + 60_000) {
                console.warn("@aws-sdk/core/protocols - WARN - JsonCodec2: you have called a string method on a Uint8Array request body. " +
                    "It has been automatically converted to string. In a future version this will throw an error.");
                warned = n;
            }
            this.string = toUtf8(this);
        }
        return this.string;
    }
}
var warned = 0;

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
class JsonShapeSerializer2 extends SerdeContextConfig {
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

class JsonCodec2 extends SerdeContextConfig {
    settings;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    createSerializer() {
        const serializer = new JsonShapeSerializer2(this.settings);
        serializer.setSerdeContext(this.serdeContext);
        return serializer;
    }
    createDeserializer() {
        const deserializer = new JsonShapeDeserializer2(this.settings);
        deserializer.setSerdeContext(this.serdeContext);
        return deserializer;
    }
}

class AwsJsonRpcProtocol extends RpcProtocol {
    serializer;
    deserializer;
    serviceTarget;
    codec;
    mixin;
    awsQueryCompatible;
    constructor({ defaultNamespace, errorTypeRegistries, serviceTarget, awsQueryCompatible, jsonCodec, }) {
        super({
            defaultNamespace,
            errorTypeRegistries,
        });
        this.serviceTarget = serviceTarget;
        this.codec =
            jsonCodec ??
                new JsonCodec2({
                    timestampFormat: {
                        useTrait: true,
                        default: 7,
                    },
                    jsonName: false,
                });
        this.serializer = this.codec.createSerializer();
        this.deserializer = this.codec.createDeserializer();
        this.awsQueryCompatible = !!awsQueryCompatible;
        this.mixin = new ProtocolLib(this.awsQueryCompatible);
    }
    async serializeRequest(operationSchema, input, context) {
        const request = await super.serializeRequest(operationSchema, input, context);
        if (!request.path.endsWith("/")) {
            request.path += "/";
        }
        request.headers["content-type"] = `application/x-amz-json-${this.getJsonRpcVersion()}`;
        request.headers["x-amz-target"] = `${this.serviceTarget}.${operationSchema.name}`;
        if (this.awsQueryCompatible) {
            request.headers["x-amzn-query-mode"] = "true";
        }
        if (deref(operationSchema.input) === "unit" || !request.body) {
            request.body = "{}";
        }
        return request;
    }
    getPayloadCodec() {
        return this.codec;
    }
    async handleError(operationSchema, context, response, dataObject, metadata) {
        const { awsQueryCompatible } = this;
        if (awsQueryCompatible) {
            this.mixin.setQueryCompatError(dataObject, response);
        }
        const errorIdentifier = loadJsonRpcErrorCode(response, dataObject, awsQueryCompatible) ?? "Unknown";
        this.mixin.compose(this.compositeErrorRegistry, errorIdentifier, this.options.defaultNamespace);
        const { errorSchema, errorMetadata } = await this.mixin.getErrorSchemaOrThrowBaseException(errorIdentifier, this.options.defaultNamespace, response, dataObject, metadata, awsQueryCompatible ? this.mixin.findQueryCompatibleError : undefined);
        const ns = NormalizedSchema.of(errorSchema);
        const message = dataObject.message ?? dataObject.Message ?? "UnknownError";
        const ErrorCtor = this.compositeErrorRegistry.getErrorCtor(errorSchema) ?? Error;
        const exception = new ErrorCtor({});
        const output = {};
        const errorDeserializer = this.codec.createDeserializer();
        for (const [name, member] of ns.structIterator()) {
            if (dataObject[name] != null) {
                output[name] = errorDeserializer.readObject(member, dataObject[name]);
            }
        }
        if (awsQueryCompatible) {
            this.mixin.queryCompatOutput(dataObject, output);
        }
        throw this.mixin.decorateServiceException(Object.assign(exception, errorMetadata, {
            $fault: ns.getMergedTraits().error,
            message,
        }, output), dataObject);
    }
}

class AwsJson1_0Protocol extends AwsJsonRpcProtocol {
    constructor({ defaultNamespace, errorTypeRegistries, serviceTarget, awsQueryCompatible, jsonCodec, }) {
        super({
            defaultNamespace,
            errorTypeRegistries,
            serviceTarget,
            awsQueryCompatible,
            jsonCodec,
        });
    }
    getShapeId() {
        return "aws.protocols#awsJson1_0";
    }
    getJsonRpcVersion() {
        return "1.0";
    }
    getDefaultContentType() {
        return "application/x-amz-json-1.0";
    }
}

class AwsJson1_1Protocol extends AwsJsonRpcProtocol {
    constructor({ defaultNamespace, errorTypeRegistries, serviceTarget, awsQueryCompatible, jsonCodec, }) {
        super({
            defaultNamespace,
            errorTypeRegistries,
            serviceTarget,
            awsQueryCompatible,
            jsonCodec,
        });
    }
    getShapeId() {
        return "aws.protocols#awsJson1_1";
    }
    getJsonRpcVersion() {
        return "1.1";
    }
    getDefaultContentType() {
        return "application/x-amz-json-1.1";
    }
}

class AwsRestJsonProtocol extends HttpBindingProtocol {
    serializer;
    deserializer;
    codec;
    mixin = new ProtocolLib();
    constructor({ defaultNamespace, errorTypeRegistries, jsonCodec, }) {
        super({
            defaultNamespace,
            errorTypeRegistries,
        });
        const settings = {
            timestampFormat: {
                useTrait: true,
                default: 7,
            },
            httpBindings: true,
            jsonName: true,
        };
        this.codec = jsonCodec ?? new JsonCodec2(settings);
        this.serializer = new HttpInterceptingShapeSerializer(this.codec.createSerializer(), settings);
        this.deserializer = new HttpInterceptingShapeDeserializer(this.codec.createDeserializer(), settings);
    }
    getShapeId() {
        return "aws.protocols#restJson1";
    }
    getPayloadCodec() {
        return this.codec;
    }
    setSerdeContext(serdeContext) {
        this.codec.setSerdeContext(serdeContext);
        super.setSerdeContext(serdeContext);
    }
    async serializeRequest(operationSchema, input, context) {
        const request = await super.serializeRequest(operationSchema, input, context);
        const inputSchema = NormalizedSchema.of(operationSchema.input);
        if (!request.headers["content-type"]) {
            const contentType = this.mixin.resolveRestContentType(this.getDefaultContentType(), inputSchema);
            if (contentType) {
                request.headers["content-type"] = contentType;
            }
        }
        if (request.body == null && request.headers["content-type"] === this.getDefaultContentType()) {
            request.body = "{}";
        }
        return request;
    }
    async deserializeResponse(operationSchema, context, response) {
        const output = await super.deserializeResponse(operationSchema, context, response);
        const outputSchema = NormalizedSchema.of(operationSchema.output);
        for (const [name, member] of outputSchema.structIterator()) {
            if (member.getMemberTraits().httpPayload && !(name in output)) {
                output[name] = null;
            }
        }
        return output;
    }
    async handleError(operationSchema, context, response, dataObject, metadata) {
        const errorIdentifier = loadRestJsonErrorCode(response, dataObject) ?? "Unknown";
        this.mixin.compose(this.compositeErrorRegistry, errorIdentifier, this.options.defaultNamespace);
        const { errorSchema, errorMetadata } = await this.mixin.getErrorSchemaOrThrowBaseException(errorIdentifier, this.options.defaultNamespace, response, dataObject, metadata);
        const ns = NormalizedSchema.of(errorSchema);
        const message = dataObject.message ?? dataObject.Message ?? "UnknownError";
        const ErrorCtor = this.compositeErrorRegistry.getErrorCtor(errorSchema) ?? Error;
        const exception = new ErrorCtor({});
        await this.deserializeHttpMessage(errorSchema, context, response, dataObject);
        const output = {};
        const errorDeserializer = this.codec.createDeserializer();
        for (const [name, member] of ns.structIterator()) {
            const target = member.getMergedTraits().jsonName ?? name;
            output[name] = errorDeserializer.readObject(member, dataObject[target]);
        }
        throw this.mixin.decorateServiceException(Object.assign(exception, errorMetadata, {
            $fault: ns.getMergedTraits().error,
            message,
        }, output), dataObject);
    }
    getDefaultContentType() {
        return "application/json";
    }
}

class JsonShapeDeserializer extends SerdeContextConfig {
    settings;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    async read(schema, data) {
        const reviver = needsReviver(schema) ? jsonReviver : undefined;
        return this._read(schema, typeof data === "string" ? JSON.parse(data, reviver) : await parseJsonBody(data, this.serdeContext, schema));
    }
    readObject(schema, data) {
        return this._read(schema, data);
    }
    _read(schema, value) {
        const isObject = value !== null && typeof value === "object";
        const ns = NormalizedSchema.of(schema);
        if (isObject) {
            if (ns.isStructSchema()) {
                const record = value;
                const union = ns.isUnionSchema();
                const out = {};
                let nameMap = void 0;
                const { jsonName } = this.settings;
                if (jsonName) {
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
                        nameMap[fromKey] = memberName;
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
                else if (typeof record.__type === "string") {
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
            if (Array.isArray(value) && ns.isListSchema()) {
                const listMember = ns.getValueSchema();
                const out = [];
                for (const item of value) {
                    out.push(this._read(listMember, item));
                }
                return out;
            }
            if (ns.isMapSchema()) {
                const mapMember = ns.getValueSchema();
                const out = {};
                for (const _k in value) {
                    if (_k === "__proto__") {
                        writeKey(out);
                    }
                    out[_k] = this._read(mapMember, value[_k]);
                }
                return out;
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
                const out = Array.isArray(value) ? [] : {};
                for (const k in value) {
                    if (k === "__proto__") {
                        writeKey(out);
                    }
                    const v = value[k];
                    if (v instanceof NumericValue) {
                        out[k] = v;
                    }
                    else {
                        out[k] = this._read(ns, v);
                    }
                }
                return out;
            }
            else {
                return structuredClone(value);
            }
        }
        return value;
    }
}

const NUMERIC_CONTROL_CHAR = String.fromCharCode(925);
class JsonReplacer {
    values = new Map();
    counter = 0;
    stage = 0;
    createReplacer() {
        if (this.stage === 1) {
            throw new Error("@aws-sdk/core/protocols - JsonReplacer already created.");
        }
        if (this.stage === 2) {
            throw new Error("@aws-sdk/core/protocols - JsonReplacer exhausted.");
        }
        this.stage = 1;
        return (key, value) => {
            if (value instanceof NumericValue) {
                const v = `${NUMERIC_CONTROL_CHAR + "nv" + this.counter++}_` + value.string;
                this.values.set(`"${v}"`, value.string);
                return v;
            }
            if (typeof value === "bigint") {
                const s = value.toString();
                const v = `${NUMERIC_CONTROL_CHAR + "b" + this.counter++}_` + s;
                this.values.set(`"${v}"`, s);
                return v;
            }
            return value;
        };
    }
    replaceInJson(json) {
        if (this.stage === 0) {
            throw new Error("@aws-sdk/core/protocols - JsonReplacer not created yet.");
        }
        if (this.stage === 2) {
            throw new Error("@aws-sdk/core/protocols - JsonReplacer exhausted.");
        }
        this.stage = 2;
        if (this.counter === 0) {
            return json;
        }
        for (const [key, value] of this.values) {
            json = json.replace(key, value);
        }
        return json;
    }
}

class JsonShapeSerializer extends SerdeContextConfig {
    settings;
    buffer;
    useReplacer = false;
    rootSchema;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    write(schema, value) {
        this.rootSchema = NormalizedSchema.of(schema);
        this.buffer = this._write(this.rootSchema, value);
    }
    flush() {
        const { rootSchema, useReplacer } = this;
        this.rootSchema = undefined;
        this.useReplacer = false;
        if (rootSchema?.isStructSchema() || rootSchema?.isDocumentSchema()) {
            if (!useReplacer) {
                return JSON.stringify(this.buffer);
            }
            const replacer = new JsonReplacer();
            return replacer.replaceInJson(JSON.stringify(this.buffer, replacer.createReplacer(), 0));
        }
        return this.buffer;
    }
    writeDiscriminatedDocument(schema, value) {
        this.write(schema, value);
        if (typeof this.buffer === "object") {
            this.buffer.__type = NormalizedSchema.of(schema).getName(true);
        }
    }
    _write(schema, value, container) {
        const isObject = value !== null && typeof value === "object";
        const ns = NormalizedSchema.of(schema);
        if (isObject) {
            if (ns.isStructSchema()) {
                const record = value;
                const out = {};
                const { jsonName } = this.settings;
                let nameMap = void 0;
                if (jsonName) {
                    nameMap = {};
                }
                let outCount = 0;
                for (const [memberName, memberSchema] of ns.structIterator()) {
                    const serializableValue = this._write(memberSchema, record[memberName], ns);
                    if (serializableValue !== undefined) {
                        let targetKey = memberName;
                        if (jsonName) {
                            targetKey = memberSchema.getMergedTraits().jsonName ?? memberName;
                            nameMap[memberName] = targetKey;
                        }
                        out[targetKey] = serializableValue;
                        outCount++;
                    }
                }
                if (ns.isUnionSchema() && outCount === 0) {
                    const { $unknown } = record;
                    if (Array.isArray($unknown)) {
                        const [k, v] = $unknown;
                        if (k === "__proto__") {
                            writeKey(out);
                        }
                        out[k] = this._write(15, v);
                    }
                }
                else if (typeof record.__type === "string") {
                    for (const k in record) {
                        const v = record[k];
                        const targetKey = jsonName ? (nameMap[k] ?? k) : k;
                        if (!(targetKey in out)) {
                            out[targetKey] = this._write(15, v);
                        }
                    }
                }
                return out;
            }
            if (Array.isArray(value) && ns.isListSchema()) {
                const listMember = ns.getValueSchema();
                const out = [];
                const sparse = !!ns.getMergedTraits().sparse;
                for (const item of value) {
                    if (sparse || item != null) {
                        out.push(this._write(listMember, item));
                    }
                }
                return out;
            }
            if (ns.isMapSchema()) {
                const mapMember = ns.getValueSchema();
                const out = {};
                const sparse = !!ns.getMergedTraits().sparse;
                for (const _k in value) {
                    const _v = value[_k];
                    if (sparse || _v != null) {
                        if (_k === "__proto__") {
                            writeKey(out);
                        }
                        out[_k] = this._write(mapMember, _v);
                    }
                }
                return out;
            }
            if (value instanceof Uint8Array && ns.isBlobSchema()) {
                if (ns === this.rootSchema) {
                    return value;
                }
                return (this.serdeContext?.base64Encoder ?? toBase64)(value);
            }
            if (value instanceof Date && (ns.isTimestampSchema() || ns.isDocumentSchema())) {
                const format = determineTimestampFormat(ns, this.settings);
                switch (format) {
                    case 5:
                        return value.toISOString().replace(".000Z", "Z");
                    case 6:
                        return dateToUtcString(value);
                    case 7:
                        return value.getTime() / 1000;
                    default:
                        console.warn("Missing timestamp format, using epoch seconds", value);
                        return value.getTime() / 1000;
                }
            }
            if (value instanceof NumericValue) {
                this.useReplacer = true;
            }
        }
        if (value === null && container?.isStructSchema()) {
            return void 0;
        }
        if (ns.isStringSchema()) {
            if (typeof value === "undefined" && ns.isIdempotencyToken()) {
                return generateIdempotencyToken();
            }
            const mediaType = ns.getMergedTraits().mediaType;
            if (value != null && mediaType) {
                const isJson = mediaType === "application/json" || mediaType.endsWith("+json");
                if (isJson) {
                    return LazyJsonString.from(value);
                }
            }
            return value;
        }
        if (typeof value === "number") {
            if (Math.abs(value) === Infinity || isNaN(value)) {
                return String(value);
            }
            return value;
        }
        if (typeof value === "string" && ns.isBlobSchema()) {
            if (ns === this.rootSchema) {
                return value;
            }
            return (this.serdeContext?.base64Encoder ?? toBase64)(value);
        }
        if (typeof value === "bigint") {
            this.useReplacer = true;
        }
        if (ns.isDocumentSchema()) {
            if (isObject) {
                if (value instanceof Uint8Array) {
                    return (this.serdeContext?.base64Encoder ?? toBase64)(value);
                }
                const out = Array.isArray(value) ? [] : {};
                for (const k in value) {
                    const v = value[k];
                    if (k === "__proto__") {
                        writeKey(out);
                    }
                    if (v instanceof NumericValue) {
                        this.useReplacer = true;
                        out[k] = v;
                    }
                    else {
                        out[k] = this._write(ns, v);
                    }
                }
                return out;
            }
            else {
                return structuredClone(value);
            }
        }
        return value;
    }
}

class JsonCodec extends SerdeContextConfig {
    settings;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    createSerializer() {
        const serializer = new JsonShapeSerializer(this.settings);
        serializer.setSerdeContext(this.serdeContext);
        return serializer;
    }
    createDeserializer() {
        const deserializer = new JsonShapeDeserializer(this.settings);
        deserializer.setSerdeContext(this.serdeContext);
        return deserializer;
    }
}

class XmlShapeDeserializer extends SerdeContextConfig {
    settings;
    stringDeserializer;
    constructor(settings) {
        super();
        this.settings = settings;
        this.stringDeserializer = new FromStringShapeDeserializer(settings);
    }
    setSerdeContext(serdeContext) {
        this.serdeContext = serdeContext;
        this.stringDeserializer.setSerdeContext(serdeContext);
    }
    read(schema, bytes, key) {
        const ns = NormalizedSchema.of(schema);
        const memberSchemas = ns.getMemberSchemas();
        const isEventPayload = ns.isStructSchema() &&
            ns.isMemberSchema() &&
            !!Object.values(memberSchemas).find((memberNs) => {
                return !!memberNs.getMemberTraits().eventPayload;
            });
        if (isEventPayload) {
            const output = {};
            const memberName = Object.keys(memberSchemas)[0];
            const eventMemberSchema = memberSchemas[memberName];
            if (eventMemberSchema.isBlobSchema()) {
                output[memberName] = bytes;
            }
            else {
                output[memberName] = this.read(memberSchemas[memberName], bytes);
            }
            return output;
        }
        const xmlString = (this.serdeContext?.utf8Encoder ?? toUtf8)(bytes);
        const parsedObject = this.parseXml(xmlString);
        return this.readSchema(schema, key ? parsedObject[key] : parsedObject);
    }
    readSchema(_schema, value) {
        const ns = NormalizedSchema.of(_schema);
        if (ns.isUnitSchema()) {
            return;
        }
        const traits = ns.getMergedTraits();
        if (ns.isListSchema() && !Array.isArray(value)) {
            return this.readSchema(ns, [value]);
        }
        if (value == null) {
            return value;
        }
        if (typeof value === "object") {
            const flat = !!traits.xmlFlattened;
            if (ns.isListSchema()) {
                const listValue = ns.getValueSchema();
                const buffer = [];
                const sourceKey = listValue.getMergedTraits().xmlName ?? "member";
                const source = flat ? value : (value[0] ?? value)[sourceKey];
                if (source == null) {
                    return buffer;
                }
                const sourceArray = Array.isArray(source) ? source : [source];
                for (const v of sourceArray) {
                    buffer.push(this.readSchema(listValue, v));
                }
                return buffer;
            }
            const buffer = {};
            if (ns.isMapSchema()) {
                const keyNs = ns.getKeySchema();
                const memberNs = ns.getValueSchema();
                let entries;
                if (flat) {
                    entries = Array.isArray(value) ? value : [value];
                }
                else {
                    entries = Array.isArray(value.entry) ? value.entry : [value.entry];
                }
                const keyProperty = keyNs.getMergedTraits().xmlName ?? "key";
                const valueProperty = memberNs.getMergedTraits().xmlName ?? "value";
                for (const entry of entries) {
                    const key = entry[keyProperty];
                    const value = entry[valueProperty];
                    if (key === "__proto__") {
                        writeKey(buffer);
                    }
                    buffer[key] = this.readSchema(memberNs, value);
                }
                return buffer;
            }
            if (ns.isStructSchema()) {
                const union = ns.isUnionSchema();
                let unionSerde;
                if (union) {
                    unionSerde = new UnionSerde(value, buffer);
                }
                for (const [memberName, memberSchema] of ns.structIterator()) {
                    const memberTraits = memberSchema.getMergedTraits();
                    const xmlObjectKey = !memberTraits.httpPayload
                        ? (memberSchema.getMemberTraits().xmlName ?? memberName)
                        : (memberTraits.xmlName ?? memberSchema.getName());
                    if (union) {
                        unionSerde.mark(xmlObjectKey);
                    }
                    if (value[xmlObjectKey] != null) {
                        buffer[memberName] = this.readSchema(memberSchema, value[xmlObjectKey]);
                    }
                }
                if (union) {
                    unionSerde.writeUnknown();
                }
                return buffer;
            }
            if (ns.isDocumentSchema()) {
                return value;
            }
            throw new Error(`@aws-sdk/core/protocols - xml deserializer unhandled schema type for ${ns.getName(true)}`);
        }
        if (ns.isListSchema()) {
            return [];
        }
        if (ns.isMapSchema() || ns.isStructSchema()) {
            return {};
        }
        return this.stringDeserializer.read(ns, value);
    }
    parseXml(xml) {
        if (xml.length) {
            let parsedObj;
            try {
                parsedObj = parseXML(xml);
            }
            catch (e) {
                if (e && typeof e === "object") {
                    Object.defineProperty(e, "$responseBodyText", {
                        value: xml,
                    });
                }
                throw e;
            }
            const textNodeName = "#text";
            const key = Object.keys(parsedObj)[0];
            const parsedObjToReturn = parsedObj[key];
            if (parsedObjToReturn[textNodeName]) {
                parsedObjToReturn[key] = parsedObjToReturn[textNodeName];
                delete parsedObjToReturn[textNodeName];
            }
            return getValueFromTextNode(parsedObjToReturn);
        }
        return {};
    }
}

class QueryShapeSerializer extends SerdeContextConfig {
    settings;
    buffer;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    write(schema, value, prefix = "") {
        if (this.buffer === undefined) {
            this.buffer = "";
        }
        const ns = NormalizedSchema.of(schema);
        if (prefix && !prefix.endsWith(".")) {
            prefix += ".";
        }
        if (ns.isBlobSchema()) {
            if (typeof value === "string" || value instanceof Uint8Array) {
                this.writeKey(prefix);
                this.writeValue((this.serdeContext?.base64Encoder ?? toBase64)(value));
            }
        }
        else if (ns.isBooleanSchema() || ns.isNumericSchema() || ns.isStringSchema()) {
            if (value != null) {
                this.writeKey(prefix);
                this.writeValue(String(value));
            }
            else if (ns.isIdempotencyToken()) {
                this.writeKey(prefix);
                this.writeValue(generateIdempotencyToken());
            }
        }
        else if (ns.isBigIntegerSchema()) {
            if (value != null) {
                this.writeKey(prefix);
                this.writeValue(String(value));
            }
        }
        else if (ns.isBigDecimalSchema()) {
            if (value != null) {
                this.writeKey(prefix);
                this.writeValue(value instanceof NumericValue ? value.string : String(value));
            }
        }
        else if (ns.isTimestampSchema()) {
            if (value instanceof Date) {
                this.writeKey(prefix);
                const format = determineTimestampFormat(ns, this.settings);
                switch (format) {
                    case 5:
                        this.writeValue(value.toISOString().replace(".000Z", "Z"));
                        break;
                    case 6:
                        this.writeValue(dateToUtcString(value));
                        break;
                    case 7:
                        this.writeValue(String(value.getTime() / 1000));
                        break;
                }
            }
        }
        else if (ns.isDocumentSchema()) {
            if (Array.isArray(value)) {
                this.write(64 | 15, value, prefix);
            }
            else if (value instanceof Date) {
                this.write(4, value, prefix);
            }
            else if (value instanceof Uint8Array) {
                this.write(21, value, prefix);
            }
            else if (value && typeof value === "object") {
                this.write(128 | 15, value, prefix);
            }
            else {
                this.writeKey(prefix);
                this.writeValue(String(value));
            }
        }
        else if (ns.isListSchema()) {
            if (Array.isArray(value)) {
                if (value.length === 0) {
                    if (this.settings.serializeEmptyLists) {
                        this.writeKey(prefix);
                        this.writeValue("");
                    }
                }
                else {
                    const member = ns.getValueSchema();
                    const flat = this.settings.flattenLists || ns.getMergedTraits().xmlFlattened;
                    let i = 1;
                    for (const item of value) {
                        if (item == null) {
                            continue;
                        }
                        const traits = member.getMergedTraits();
                        const suffix = this.getKey("member", traits.xmlName, traits.ec2QueryName);
                        const key = flat ? `${prefix}${i}` : `${prefix}${suffix}.${i}`;
                        this.write(member, item, key);
                        ++i;
                    }
                }
            }
        }
        else if (ns.isMapSchema()) {
            if (value && typeof value === "object") {
                const keySchema = ns.getKeySchema();
                const memberSchema = ns.getValueSchema();
                const flat = ns.getMergedTraits().xmlFlattened;
                let i = 1;
                for (const k in value) {
                    const v = value[k];
                    if (v == null) {
                        continue;
                    }
                    const keyTraits = keySchema.getMergedTraits();
                    const keySuffix = this.getKey("key", keyTraits.xmlName, keyTraits.ec2QueryName);
                    const key = flat ? `${prefix}${i}.${keySuffix}` : `${prefix}entry.${i}.${keySuffix}`;
                    const valTraits = memberSchema.getMergedTraits();
                    const valueSuffix = this.getKey("value", valTraits.xmlName, valTraits.ec2QueryName);
                    const valueKey = flat ? `${prefix}${i}.${valueSuffix}` : `${prefix}entry.${i}.${valueSuffix}`;
                    this.write(keySchema, k, key);
                    this.write(memberSchema, v, valueKey);
                    ++i;
                }
            }
        }
        else if (ns.isStructSchema()) {
            if (value && typeof value === "object") {
                let didWriteMember = false;
                for (const [memberName, member] of ns.structIterator()) {
                    if (value[memberName] == null && !member.isIdempotencyToken()) {
                        continue;
                    }
                    const traits = member.getMergedTraits();
                    const suffix = this.getKey(memberName, traits.xmlName, traits.ec2QueryName, "struct");
                    const key = `${prefix}${suffix}`;
                    this.write(member, value[memberName], key);
                    didWriteMember = true;
                }
                if (!didWriteMember && ns.isUnionSchema()) {
                    const { $unknown } = value;
                    if (Array.isArray($unknown)) {
                        const [k, v] = $unknown;
                        const key = `${prefix}${k}`;
                        this.write(15, v, key);
                    }
                }
            }
        }
        else if (ns.isUnitSchema()) ;
        else {
            throw new Error(`@aws-sdk/core/protocols - QuerySerializer unrecognized schema type ${ns.getName(true)}`);
        }
    }
    flush() {
        if (this.buffer === undefined) {
            throw new Error("@aws-sdk/core/protocols - QuerySerializer cannot flush with nothing written to buffer.");
        }
        const str = this.buffer;
        delete this.buffer;
        return str;
    }
    getKey(memberName, xmlName, ec2QueryName, keySource) {
        const { ec2, capitalizeKeys } = this.settings;
        if (ec2 && ec2QueryName) {
            return ec2QueryName;
        }
        const key = xmlName ?? memberName;
        if (capitalizeKeys && keySource === "struct") {
            return key[0].toUpperCase() + key.slice(1);
        }
        return key;
    }
    writeKey(key) {
        if (key.endsWith(".")) {
            key = key.slice(0, key.length - 1);
        }
        this.buffer += `&${extendedEncodeURIComponent(key)}=`;
    }
    writeValue(value) {
        this.buffer += extendedEncodeURIComponent(value);
    }
}

class AwsQueryProtocol extends RpcProtocol {
    options;
    serializer;
    deserializer;
    mixin = new ProtocolLib();
    constructor(options) {
        super({
            defaultNamespace: options.defaultNamespace,
            errorTypeRegistries: options.errorTypeRegistries,
        });
        this.options = options;
        const settings = {
            timestampFormat: {
                useTrait: true,
                default: 5,
            },
            httpBindings: false,
            xmlNamespace: options.xmlNamespace,
            serviceNamespace: options.defaultNamespace,
            serializeEmptyLists: true,
        };
        this.serializer = new QueryShapeSerializer(settings);
        this.deserializer = new XmlShapeDeserializer(settings);
    }
    getShapeId() {
        return "aws.protocols#awsQuery";
    }
    setSerdeContext(serdeContext) {
        this.serializer.setSerdeContext(serdeContext);
        this.deserializer.setSerdeContext(serdeContext);
    }
    getPayloadCodec() {
        throw new Error("AWSQuery protocol has no payload codec.");
    }
    async serializeRequest(operationSchema, input, context) {
        const request = await super.serializeRequest(operationSchema, input, context);
        if (!request.path.endsWith("/")) {
            request.path += "/";
        }
        request.headers["content-type"] = "application/x-www-form-urlencoded";
        if (deref(operationSchema.input) === "unit" || !request.body) {
            request.body = "";
        }
        const action = operationSchema.name.split("#")[1] ?? operationSchema.name;
        request.body = `Action=${action}&Version=${this.options.version}` + request.body;
        if (request.body.endsWith("&")) {
            request.body = request.body.slice(-1);
        }
        return request;
    }
    async deserializeResponse(operationSchema, context, response) {
        const deserializer = this.deserializer;
        const ns = NormalizedSchema.of(operationSchema.output);
        const dataObject = {};
        if (response.statusCode >= 300) {
            const bytes = await collectBody(response.body, context);
            if (bytes.byteLength > 0) {
                Object.assign(dataObject, await deserializer.read(15, bytes));
            }
            await this.handleError(operationSchema, context, response, dataObject, this.deserializeMetadata(response));
        }
        for (const header in response.headers) {
            const value = response.headers[header];
            delete response.headers[header];
            response.headers[header.toLowerCase()] = value;
        }
        const shortName = operationSchema.name.split("#")[1] ?? operationSchema.name;
        const awsQueryResultKey = ns.isStructSchema() && this.useNestedResult() ? shortName + "Result" : undefined;
        const bytes = await collectBody(response.body, context);
        if (bytes.byteLength > 0) {
            Object.assign(dataObject, await deserializer.read(ns, bytes, awsQueryResultKey));
        }
        dataObject.$metadata = this.deserializeMetadata(response);
        return dataObject;
    }
    useNestedResult() {
        return true;
    }
    async handleError(operationSchema, context, response, dataObject, metadata) {
        const errorIdentifier = this.loadQueryErrorCode(response, dataObject) ?? "Unknown";
        this.mixin.compose(this.compositeErrorRegistry, errorIdentifier, this.options.defaultNamespace);
        const errorData = this.loadQueryError(dataObject) ?? {};
        const message = this.loadQueryErrorMessage(dataObject);
        errorData.message = message;
        errorData.Error = {
            Type: errorData.Type,
            Code: errorData.Code,
            Message: message,
        };
        const { errorSchema, errorMetadata } = await this.mixin.getErrorSchemaOrThrowBaseException(errorIdentifier, this.options.defaultNamespace, response, errorData, metadata, this.mixin.findQueryCompatibleError);
        const ns = NormalizedSchema.of(errorSchema);
        const ErrorCtor = this.compositeErrorRegistry.getErrorCtor(errorSchema) ?? Error;
        const exception = new ErrorCtor({});
        const output = {
            Type: errorData.Error.Type,
            Code: errorData.Error.Code,
            Error: errorData.Error,
        };
        for (const [name, member] of ns.structIterator()) {
            const target = member.getMergedTraits().xmlName ?? name;
            const value = errorData[target] ?? dataObject[target];
            output[name] = this.deserializer.readSchema(member, value);
        }
        throw this.mixin.decorateServiceException(Object.assign(exception, errorMetadata, {
            $fault: ns.getMergedTraits().error,
            message,
        }, output), dataObject);
    }
    loadQueryErrorCode(output, data) {
        const code = (data.Errors?.[0]?.Error ?? data.Errors?.Error ?? data.Error)?.Code;
        if (code !== undefined) {
            return code;
        }
        if (output.statusCode == 404) {
            return "NotFound";
        }
    }
    loadQueryError(data) {
        return data.Errors?.[0]?.Error ?? data.Errors?.Error ?? data.Error;
    }
    loadQueryErrorMessage(data) {
        const errorData = this.loadQueryError(data);
        return errorData?.message ?? errorData?.Message ?? data.message ?? data.Message ?? "Unknown";
    }
    getDefaultContentType() {
        return "application/x-www-form-urlencoded";
    }
}

class AwsEc2QueryProtocol extends AwsQueryProtocol {
    options;
    constructor(options) {
        super(options);
        this.options = options;
        const ec2Settings = {
            capitalizeKeys: true,
            flattenLists: true,
            serializeEmptyLists: false,
            ec2: true,
        };
        Object.assign(this.serializer.settings, ec2Settings);
    }
    getShapeId() {
        return "aws.protocols#ec2Query";
    }
    useNestedResult() {
        return false;
    }
}

const parseXmlBody = (streamBody, context) => collectBodyString(streamBody, context).then((encoded) => {
    if (encoded.length) {
        let parsedObj;
        try {
            parsedObj = parseXML(encoded);
        }
        catch (e) {
            if (e && typeof e === "object") {
                Object.defineProperty(e, "$responseBodyText", {
                    value: encoded,
                });
            }
            throw e;
        }
        const textNodeName = "#text";
        const key = Object.keys(parsedObj)[0];
        const parsedObjToReturn = parsedObj[key];
        if (parsedObjToReturn[textNodeName]) {
            parsedObjToReturn[key] = parsedObjToReturn[textNodeName];
            delete parsedObjToReturn[textNodeName];
        }
        return getValueFromTextNode(parsedObjToReturn);
    }
    return {};
});
const parseXmlErrorBody = async (errorBody, context) => {
    const value = await parseXmlBody(errorBody, context);
    if (value.Error) {
        value.Error.message = value.Error.message ?? value.Error.Message;
    }
    return value;
};
const loadRestXmlErrorCode = (output, data) => {
    if (data?.Error?.Code !== undefined) {
        return data.Error.Code;
    }
    if (data?.Code !== undefined) {
        return data.Code;
    }
    if (output.statusCode == 404) {
        return "NotFound";
    }
};

class XmlShapeSerializer extends SerdeContextConfig {
    settings;
    stringBuffer;
    byteBuffer;
    buffer;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    write(schema, value) {
        const ns = NormalizedSchema.of(schema);
        if (ns.isStringSchema() && typeof value === "string") {
            this.stringBuffer = value;
        }
        else if (ns.isBlobSchema()) {
            this.byteBuffer =
                "byteLength" in value
                    ? value
                    : (this.serdeContext?.base64Decoder ?? fromBase64)(value);
        }
        else {
            this.buffer = this.writeStruct(ns, value, undefined);
            const traits = ns.getMergedTraits();
            if (traits.httpPayload && !traits.xmlName) {
                this.buffer.withName(ns.getName());
            }
        }
    }
    flush() {
        if (this.byteBuffer !== undefined) {
            const bytes = this.byteBuffer;
            delete this.byteBuffer;
            return bytes;
        }
        if (this.stringBuffer !== undefined) {
            const str = this.stringBuffer;
            delete this.stringBuffer;
            return str;
        }
        const buffer = this.buffer;
        if (this.settings.xmlNamespace) {
            if (!buffer?.attributes?.["xmlns"]) {
                buffer.addAttribute("xmlns", this.settings.xmlNamespace);
            }
        }
        delete this.buffer;
        return buffer.toString();
    }
    writeStruct(ns, value, parentXmlns) {
        const traits = ns.getMergedTraits();
        const name = ns.isMemberSchema() && !traits.httpPayload
            ? (ns.getMemberTraits().xmlName ?? ns.getMemberName())
            : (traits.xmlName ?? ns.getName());
        if (!name || !ns.isStructSchema()) {
            throw new Error(`@aws-sdk/core/protocols - xml serializer, cannot write struct with empty name or non-struct, schema=${ns.getName(true)}.`);
        }
        const structXmlNode = XmlNode.of(name);
        const [xmlnsAttr, xmlns] = this.getXmlnsAttribute(ns, parentXmlns);
        for (const [memberName, memberSchema] of ns.structIterator()) {
            const val = value[memberName];
            if (val != null || memberSchema.isIdempotencyToken()) {
                if (memberSchema.getMergedTraits().xmlAttribute) {
                    structXmlNode.addAttribute(memberSchema.getMergedTraits().xmlName ?? memberName, this.writeSimple(memberSchema, val));
                    continue;
                }
                if (memberSchema.isListSchema()) {
                    this.writeList(memberSchema, val, structXmlNode, xmlns);
                }
                else if (memberSchema.isMapSchema()) {
                    this.writeMap(memberSchema, val, structXmlNode, xmlns);
                }
                else if (memberSchema.isStructSchema()) {
                    structXmlNode.addChildNode(this.writeStruct(memberSchema, val, xmlns));
                }
                else {
                    const memberNode = XmlNode.of(memberSchema.getMergedTraits().xmlName ?? memberSchema.getMemberName());
                    this.writeSimpleInto(memberSchema, val, memberNode, xmlns);
                    structXmlNode.addChildNode(memberNode);
                }
            }
        }
        const { $unknown } = value;
        if ($unknown && ns.isUnionSchema() && Array.isArray($unknown) && Object.keys(value).length === 1) {
            const [k, v] = $unknown;
            const node = XmlNode.of(k);
            if (typeof v !== "string") {
                if (value instanceof XmlNode || value instanceof XmlText) {
                    structXmlNode.addChildNode(value);
                }
                else {
                    throw new Error(`@aws-sdk - $unknown union member in XML requires ` +
                        `value of type string, @aws-sdk/xml-builder::XmlNode or XmlText.`);
                }
            }
            this.writeSimpleInto(0, v, node, xmlns);
            structXmlNode.addChildNode(node);
        }
        if (xmlns) {
            structXmlNode.addAttribute(xmlnsAttr, xmlns);
        }
        return structXmlNode;
    }
    writeList(listMember, array, container, parentXmlns) {
        if (!listMember.isMemberSchema()) {
            throw new Error(`@aws-sdk/core/protocols - xml serializer, cannot write non-member list: ${listMember.getName(true)}`);
        }
        const listTraits = listMember.getMergedTraits();
        const listValueSchema = listMember.getValueSchema();
        const listValueTraits = listValueSchema.getMergedTraits();
        const sparse = !!listValueTraits.sparse;
        const flat = !!listTraits.xmlFlattened;
        const [xmlnsAttr, xmlns] = this.getXmlnsAttribute(listMember, parentXmlns);
        const writeItem = (container, value) => {
            if (listValueSchema.isListSchema()) {
                this.writeList(listValueSchema, Array.isArray(value) ? value : [value], container, xmlns);
            }
            else if (listValueSchema.isMapSchema()) {
                this.writeMap(listValueSchema, value, container, xmlns);
            }
            else if (listValueSchema.isStructSchema()) {
                const struct = this.writeStruct(listValueSchema, value, xmlns);
                container.addChildNode(struct.withName(flat ? (listTraits.xmlName ?? listMember.getMemberName()) : (listValueTraits.xmlName ?? "member")));
            }
            else {
                const listItemNode = XmlNode.of(flat ? (listTraits.xmlName ?? listMember.getMemberName()) : (listValueTraits.xmlName ?? "member"));
                this.writeSimpleInto(listValueSchema, value, listItemNode, xmlns);
                container.addChildNode(listItemNode);
            }
        };
        if (flat) {
            for (const value of array) {
                if (sparse || value != null) {
                    writeItem(container, value);
                }
            }
        }
        else {
            const listNode = XmlNode.of(listTraits.xmlName ?? listMember.getMemberName());
            if (xmlns) {
                listNode.addAttribute(xmlnsAttr, xmlns);
            }
            for (const value of array) {
                if (sparse || value != null) {
                    writeItem(listNode, value);
                }
            }
            container.addChildNode(listNode);
        }
    }
    writeMap(mapMember, map, container, parentXmlns, containerIsMap = false) {
        if (!mapMember.isMemberSchema()) {
            throw new Error(`@aws-sdk/core/protocols - xml serializer, cannot write non-member map: ${mapMember.getName(true)}`);
        }
        const mapTraits = mapMember.getMergedTraits();
        const mapKeySchema = mapMember.getKeySchema();
        const mapKeyTraits = mapKeySchema.getMergedTraits();
        const keyTag = mapKeyTraits.xmlName ?? "key";
        const mapValueSchema = mapMember.getValueSchema();
        const mapValueTraits = mapValueSchema.getMergedTraits();
        const valueTag = mapValueTraits.xmlName ?? "value";
        const sparse = !!mapValueTraits.sparse;
        const flat = !!mapTraits.xmlFlattened;
        const [xmlnsAttr, xmlns] = this.getXmlnsAttribute(mapMember, parentXmlns);
        const addKeyValue = (entry, key, val) => {
            const keyNode = XmlNode.of(keyTag, key);
            const [keyXmlnsAttr, keyXmlns] = this.getXmlnsAttribute(mapKeySchema, xmlns);
            if (keyXmlns) {
                keyNode.addAttribute(keyXmlnsAttr, keyXmlns);
            }
            entry.addChildNode(keyNode);
            let valueNode = XmlNode.of(valueTag);
            if (mapValueSchema.isListSchema()) {
                this.writeList(mapValueSchema, val, valueNode, xmlns);
            }
            else if (mapValueSchema.isMapSchema()) {
                this.writeMap(mapValueSchema, val, valueNode, xmlns, true);
            }
            else if (mapValueSchema.isStructSchema()) {
                valueNode = this.writeStruct(mapValueSchema, val, xmlns);
            }
            else {
                this.writeSimpleInto(mapValueSchema, val, valueNode, xmlns);
            }
            entry.addChildNode(valueNode);
        };
        if (flat) {
            for (const key in map) {
                const val = map[key];
                if (sparse || val != null) {
                    const entry = XmlNode.of(mapTraits.xmlName ?? mapMember.getMemberName());
                    addKeyValue(entry, key, val);
                    container.addChildNode(entry);
                }
            }
        }
        else {
            let mapNode;
            if (!containerIsMap) {
                mapNode = XmlNode.of(mapTraits.xmlName ?? mapMember.getMemberName());
                if (xmlns) {
                    mapNode.addAttribute(xmlnsAttr, xmlns);
                }
                container.addChildNode(mapNode);
            }
            for (const key in map) {
                const val = map[key];
                if (sparse || val != null) {
                    const entry = XmlNode.of("entry");
                    addKeyValue(entry, key, val);
                    (containerIsMap ? container : mapNode).addChildNode(entry);
                }
            }
        }
    }
    writeSimple(_schema, value) {
        if (null === value) {
            throw new Error("@aws-sdk/core/protocols - (XML serializer) cannot write null value.");
        }
        const ns = NormalizedSchema.of(_schema);
        let nodeContents = null;
        if (value && typeof value === "object") {
            if (ns.isBlobSchema()) {
                nodeContents = (this.serdeContext?.base64Encoder ?? toBase64)(value);
            }
            else if (ns.isTimestampSchema() && value instanceof Date) {
                const format = determineTimestampFormat(ns, this.settings);
                switch (format) {
                    case 5:
                        nodeContents = value.toISOString().replace(".000Z", "Z");
                        break;
                    case 6:
                        nodeContents = dateToUtcString(value);
                        break;
                    case 7:
                        nodeContents = String(value.getTime() / 1000);
                        break;
                    default:
                        console.warn("Missing timestamp format, using http date", value);
                        nodeContents = dateToUtcString(value);
                        break;
                }
            }
            else if (ns.isBigDecimalSchema() && value) {
                if (value instanceof NumericValue) {
                    return value.string;
                }
                return String(value);
            }
            else if (ns.isMapSchema() || ns.isListSchema()) {
                throw new Error("@aws-sdk/core/protocols - xml serializer, cannot call _write() on List/Map schema, call writeList or writeMap() instead.");
            }
            else {
                throw new Error(`@aws-sdk/core/protocols - xml serializer, unhandled schema type for object value and schema: ${ns.getName(true)}`);
            }
        }
        if (ns.isBooleanSchema() || ns.isNumericSchema() || ns.isBigIntegerSchema() || ns.isBigDecimalSchema()) {
            nodeContents = String(value);
        }
        if (ns.isStringSchema()) {
            if (value === undefined && ns.isIdempotencyToken()) {
                nodeContents = generateIdempotencyToken();
            }
            else {
                nodeContents = String(value);
            }
        }
        if (nodeContents === null) {
            throw new Error(`Unhandled schema-value pair ${ns.getName(true)}=${value}`);
        }
        return nodeContents;
    }
    writeSimpleInto(_schema, value, into, parentXmlns) {
        const nodeContents = this.writeSimple(_schema, value);
        const ns = NormalizedSchema.of(_schema);
        const content = new XmlText(nodeContents);
        const [xmlnsAttr, xmlns] = this.getXmlnsAttribute(ns, parentXmlns);
        if (xmlns) {
            into.addAttribute(xmlnsAttr, xmlns);
        }
        into.addChildNode(content);
    }
    getXmlnsAttribute(ns, parentXmlns) {
        const traits = ns.getMergedTraits();
        const [prefix, xmlns] = traits.xmlNamespace ?? [];
        if (xmlns && xmlns !== parentXmlns) {
            return [prefix ? `xmlns:${prefix}` : "xmlns", xmlns];
        }
        return [void 0, void 0];
    }
}

class XmlCodec extends SerdeContextConfig {
    settings;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    createSerializer() {
        const serializer = new XmlShapeSerializer(this.settings);
        serializer.setSerdeContext(this.serdeContext);
        return serializer;
    }
    createDeserializer() {
        const deserializer = new XmlShapeDeserializer(this.settings);
        deserializer.setSerdeContext(this.serdeContext);
        return deserializer;
    }
}

class AwsRestXmlProtocol extends HttpBindingProtocol {
    codec;
    serializer;
    deserializer;
    mixin = new ProtocolLib();
    constructor(options) {
        super(options);
        const settings = {
            timestampFormat: {
                useTrait: true,
                default: 5,
            },
            httpBindings: true,
            xmlNamespace: options.xmlNamespace,
            serviceNamespace: options.defaultNamespace,
        };
        this.codec = new XmlCodec(settings);
        this.serializer = new HttpInterceptingShapeSerializer(this.codec.createSerializer(), settings);
        this.deserializer = new HttpInterceptingShapeDeserializer(this.codec.createDeserializer(), settings);
    }
    getPayloadCodec() {
        return this.codec;
    }
    getShapeId() {
        return "aws.protocols#restXml";
    }
    async serializeRequest(operationSchema, input, context) {
        const request = await super.serializeRequest(operationSchema, input, context);
        const inputSchema = NormalizedSchema.of(operationSchema.input);
        if (!request.headers["content-type"]) {
            const contentType = this.mixin.resolveRestContentType(this.getDefaultContentType(), inputSchema);
            if (contentType) {
                request.headers["content-type"] = contentType;
            }
        }
        if (typeof request.body === "string" &&
            request.headers["content-type"] === this.getDefaultContentType() &&
            !request.body.startsWith("<?xml ") &&
            !this.hasUnstructuredPayloadBinding(inputSchema)) {
            request.body = '<?xml version="1.0" encoding="UTF-8"?>' + request.body;
        }
        return request;
    }
    async deserializeResponse(operationSchema, context, response) {
        return super.deserializeResponse(operationSchema, context, response);
    }
    async handleError(operationSchema, context, response, dataObject, metadata) {
        const errorIdentifier = loadRestXmlErrorCode(response, dataObject) ?? "Unknown";
        this.mixin.compose(this.compositeErrorRegistry, errorIdentifier, this.options.defaultNamespace);
        if (dataObject.Error && typeof dataObject.Error === "object") {
            for (const key of Object.keys(dataObject.Error)) {
                dataObject[key] = dataObject.Error[key];
                if (key.toLowerCase() === "message") {
                    dataObject.message = dataObject.Error[key];
                }
            }
        }
        if (dataObject.RequestId && !metadata.requestId) {
            metadata.requestId = dataObject.RequestId;
        }
        const { errorSchema, errorMetadata } = await this.mixin.getErrorSchemaOrThrowBaseException(errorIdentifier, this.options.defaultNamespace, response, dataObject, metadata);
        const ns = NormalizedSchema.of(errorSchema);
        const message = dataObject.Error?.message ??
            dataObject.Error?.Message ??
            dataObject.message ??
            dataObject.Message ??
            "UnknownError";
        const ErrorCtor = this.compositeErrorRegistry.getErrorCtor(errorSchema) ?? Error;
        const exception = new ErrorCtor({});
        await this.deserializeHttpMessage(errorSchema, context, response, dataObject);
        const output = {};
        const errorDeserializer = this.codec.createDeserializer();
        for (const [name, member] of ns.structIterator()) {
            const target = member.getMergedTraits().xmlName ?? name;
            const value = dataObject.Error?.[target] ?? dataObject[target];
            output[name] = errorDeserializer.readSchema(member, value);
        }
        throw this.mixin.decorateServiceException(Object.assign(exception, errorMetadata, {
            $fault: ns.getMergedTraits().error,
            message,
        }, output), dataObject);
    }
    getDefaultContentType() {
        return "application/xml";
    }
    hasUnstructuredPayloadBinding(ns) {
        for (const [, member] of ns.structIterator()) {
            if (member.getMergedTraits().httpPayload) {
                return !(member.isStructSchema() || member.isMapSchema() || member.isListSchema());
            }
        }
        return false;
    }
}

const awsExpectUnion = (value) => {
    if (value == null) {
        return undefined;
    }
    if (typeof value === "object" && "__type" in value) {
        delete value.__type;
    }
    return expectUnion(value);
};

const _toStr = (val) => {
    if (val == null) {
        return val;
    }
    if (typeof val === "number" || typeof val === "bigint") {
        const warning = new Error(`Received number ${val} where a string was expected.`);
        warning.name = "Warning";
        console.warn(warning);
        return String(val);
    }
    if (typeof val === "boolean") {
        const warning = new Error(`Received boolean ${val} where a string was expected.`);
        warning.name = "Warning";
        console.warn(warning);
        return String(val);
    }
    return val;
};
const _toBool = (val) => {
    if (val == null) {
        return val;
    }
    if (typeof val === "string") {
        const lowercase = val.toLowerCase();
        if (val !== "" && lowercase !== "false" && lowercase !== "true") {
            const warning = new Error(`Received string "${val}" where a boolean was expected.`);
            warning.name = "Warning";
            console.warn(warning);
        }
        return val !== "" && lowercase !== "false";
    }
    return val;
};
const _toNum = (val) => {
    if (val == null) {
        return val;
    }
    if (typeof val === "string") {
        const num = Number(val);
        if (num.toString() !== val) {
            const warning = new Error(`Received string "${val}" where a number was expected.`);
            warning.name = "Warning";
            console.warn(warning);
            return val;
        }
        return num;
    }
    return val;
};

exports.AwsEc2QueryProtocol = AwsEc2QueryProtocol;
exports.AwsJson1_0Protocol = AwsJson1_0Protocol;
exports.AwsJson1_1Protocol = AwsJson1_1Protocol;
exports.AwsJsonRpcProtocol = AwsJsonRpcProtocol;
exports.AwsQueryProtocol = AwsQueryProtocol;
exports.AwsRestJsonProtocol = AwsRestJsonProtocol;
exports.AwsRestXmlProtocol = AwsRestXmlProtocol;
exports.AwsSmithyRpcV2CborProtocol = AwsSmithyRpcV2CborProtocol;
exports.JsonCodec = JsonCodec;
exports.JsonCodec2 = JsonCodec2;
exports.JsonShapeDeserializer = JsonShapeDeserializer;
exports.JsonShapeDeserializer2 = JsonShapeDeserializer2;
exports.JsonShapeSerializer = JsonShapeSerializer;
exports.JsonShapeSerializer2 = JsonShapeSerializer2;
exports.QueryShapeSerializer = QueryShapeSerializer;
exports.XmlCodec = XmlCodec;
exports.XmlShapeDeserializer = XmlShapeDeserializer;
exports.XmlShapeSerializer = XmlShapeSerializer;
exports._toBool = _toBool;
exports._toNum = _toNum;
exports._toStr = _toStr;
exports.awsExpectUnion = awsExpectUnion;
exports.loadJsonRpcErrorCode = loadJsonRpcErrorCode;
exports.loadRestJsonErrorCode = loadRestJsonErrorCode;
exports.loadRestXmlErrorCode = loadRestXmlErrorCode;
exports.parseJsonBody = parseJsonBody;
exports.parseJsonErrorBody = parseJsonErrorBody;
exports.parseXmlBody = parseXmlBody;
exports.parseXmlErrorBody = parseXmlErrorBody;
