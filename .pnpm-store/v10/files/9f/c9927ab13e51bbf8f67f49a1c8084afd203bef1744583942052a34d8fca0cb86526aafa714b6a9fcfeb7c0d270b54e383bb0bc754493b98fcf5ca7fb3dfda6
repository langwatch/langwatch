"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeResource = exports.writeInstrumentationScope = exports.writeAnyValue = exports.writeKeyValue = exports.writeAttributes = exports.writeHrTimeAsFixed64 = void 0;
/**
 * Write HrTime [seconds, nanoseconds] directly as fixed64 to the serializer.
 * Converts to nanoseconds and writes as 64-bit little-endian integer without allocations.
 *
 * HrTime represents: total_nanos = seconds * 1_000_000_000 + nanoseconds
 * We need to split this into low (bits 0-31) and high (bits 32-63).
 *
 * @param serializer - The protobuf writer
 * @param hrTime - HrTime tuple [seconds, nanoseconds]
 */
function writeHrTimeAsFixed64(serializer, hrTime) {
    const seconds = hrTime[0];
    const nanos = hrTime[1];
    // Calculate total nanoseconds (seconds * 1_000_000_000 + nanos) split into [low32, high32].
    //
    // We cannot use `seconds * 1e9` directly because for Unix timestamps
    // (seconds > ~9_007_199) the product exceeds Number.MAX_SAFE_INTEGER and loses
    // integer precision in IEEE 754 double arithmetic.
    //
    // So we split `seconds` into its lower 16 bits and remaining upper bits so
    // every multiplication stays
    // within the safe-integer range (< 2^53):
    //   secondsLower16Bits * 1e9 <= 65535 * 1e9 ≈ 6.55e13 < 2^53
    //   secondsUpperBits   * 1e9 <= 65535 * 1e9 ≈ 6.55e13 < 2^53
    //
    // Then recombine:
    //   seconds * 1e9 =
    //     secondsUpperBits * 1e9 * 2^16 +
    //     secondsLower16Bits * 1e9
    const nanosPerSecond = 1000000000;
    // Split `seconds` into low 16 bits and the remaining upper bits.
    // This avoids the signed 32-bit seconds limit behind the Year 2038 problem:
    // the practical limit here is the encoded fixed64 range. Callers must keep
    // `seconds * 1e9 + nanos` within uint64, i.e. up to
    // [18_446_744_073, 709_551_615]. Beyond that, the serialized value wraps.
    const secondsLower16Bits = seconds & 0xffff; // bits 0-15 of seconds
    const secondsUpperBits = (seconds / 0x10000) >>> 0; // bits 16+ of seconds
    const nanosFromLower16Bits = secondsLower16Bits * nanosPerSecond; // exact integer, < 2^53
    const nanosFromUpperBits = secondsUpperBits * nanosPerSecond; // exact integer, < 2^53
    // Split the lower-16-bit contribution into [low32, high32].
    const lower16ContributionLow32 = nanosFromLower16Bits >>> 0;
    const lower16ContributionHigh32 = Math.floor(nanosFromLower16Bits / 0x100000000);
    // The upper-bits contribution is shifted left by 16 bits when recombined.
    const upperBitsContributionLow32 = ((nanosFromUpperBits & 0xffff) * 0x10000) >>> 0;
    const upperBitsContributionHigh32 = (nanosFromUpperBits / 0x10000) >>> 0;
    // Add the two contributions plus the sub-second nanoseconds with carry propagation.
    const low32WithCarry = lower16ContributionLow32 + upperBitsContributionLow32 + nanos;
    const totalLow = low32WithCarry >>> 0;
    const carry = Math.floor(low32WithCarry / 0x100000000); // 0, 1, or 2
    const totalHigh = (lower16ContributionHigh32 + upperBitsContributionHigh32 + carry) >>> 0;
    serializer.writeFixed64(totalLow, totalHigh);
}
exports.writeHrTimeAsFixed64 = writeHrTimeAsFixed64;
/**
 * Write Attributes directly to protobuf as repeated KeyValue
 */
function writeAttributes(writer, attributes, fieldNumber) {
    for (const key in attributes) {
        if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
            continue;
        }
        const value = attributes[key];
        writer.writeTag(fieldNumber, 2); // repeated KeyValue attributes (field varies, length-delimited)
        const kvStart = writer.startLengthDelimited();
        const startPos = writer.pos;
        writeKeyValue(writer, key, value);
        writer.finishLengthDelimited(kvStart, writer.pos - startPos);
    }
}
exports.writeAttributes = writeAttributes;
/**
 * Write a KeyValue pair directly to protobuf
 */
function writeKeyValue(writer, key, value) {
    writer.writeTag(1, 2); // KeyValue.key (field 1, string, length-delimited)
    writer.writeString(key);
    writer.writeTag(2, 2); // KeyValue.value (field 2, AnyValue, length-delimited)
    const valueStart = writer.startLengthDelimited();
    const startPos = writer.pos;
    writeAnyValue(writer, value);
    writer.finishLengthDelimited(valueStart, writer.pos - startPos);
}
exports.writeKeyValue = writeKeyValue;
// int64 range bounds for int_value vs double_value encoding.
// -(2^63) is the signed int64 minimum; 2^63 is one past the maximum.
// Both are exact IEEE 754 doubles (powers of two), so comparisons are precise.
const MIN_64_BIT_INT = -(2 ** 63);
const MAX_64_BIT_INT = 2 ** 63;
/**
 * Write an AnyValue directly from raw attribute value to protobuf
 */
function writeAnyValue(writer, value) {
    const t = typeof value;
    if (t === 'string') {
        writer.writeTag(1, 2); // AnyValue.string_value (field 1, length-delimited)
        writer.writeString(value);
    }
    else if (t === 'boolean') {
        writer.writeTag(2, 0); // AnyValue.bool_value (field 2, varint)
        writer.writeVarint(value ? 1 : 0);
    }
    else if (t === 'number') {
        const numValue = value;
        // Encode as int_value (int64) when the number is an integer within the int64
        // range. Number.isSafeInteger() would be too conservative — integers beyond
        // 2^53-1 that are exactly representable in IEEE 754 (e.g. powers of two)
        // still fit in int64 and must not be downgraded to double_value.
        if (Number.isInteger(numValue) &&
            numValue >= MIN_64_BIT_INT &&
            numValue < MAX_64_BIT_INT) {
            writer.writeTag(3, 0); // AnyValue.int_value (field 3, varint)
            writer.writeVarint(numValue);
        }
        else {
            writer.writeTag(4, 1); // AnyValue.double_value (field 4, fixed64)
            writer.writeDouble(numValue);
        }
    }
    else if (value instanceof Uint8Array) {
        writer.writeTag(7, 2); // AnyValue.bytes_value (field 7, length-delimited)
        writer.writeBytes(value);
    }
    else if (Array.isArray(value)) {
        writer.writeTag(5, 2); // AnyValue.array_value (field 5, ArrayValue, length-delimited)
        const arrayStart = writer.startLengthDelimited();
        const arrayStartPos = writer.pos;
        for (const item of value) {
            writer.writeTag(1, 2); // ArrayValue.values (field 1, AnyValue, length-delimited)
            const itemStart = writer.startLengthDelimited();
            const itemStartPos = writer.pos;
            writeAnyValue(writer, item);
            writer.finishLengthDelimited(itemStart, writer.pos - itemStartPos);
        }
        writer.finishLengthDelimited(arrayStart, writer.pos - arrayStartPos);
    }
    else if (t === 'object' && value != null) {
        writer.writeTag(6, 2); // AnyValue.kvlist_value (field 6, KeyValueList, length-delimited)
        const kvlistStart = writer.startLengthDelimited();
        const kvlistStartPos = writer.pos;
        const obj = value;
        for (const k in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, k)) {
                continue;
            }
            const v = obj[k];
            writer.writeTag(1, 2); // KeyValueList.values (field 1, KeyValue, length-delimited)
            const kvStart = writer.startLengthDelimited();
            const kvStartPos = writer.pos;
            writer.writeTag(1, 2); // KeyValue.key (field 1, string, length-delimited)
            writer.writeString(k);
            writer.writeTag(2, 2); // KeyValue.value (field 2, AnyValue, length-delimited)
            const valueStart = writer.startLengthDelimited();
            const valueStartPos = writer.pos;
            writeAnyValue(writer, v);
            writer.finishLengthDelimited(valueStart, writer.pos - valueStartPos);
            writer.finishLengthDelimited(kvStart, writer.pos - kvStartPos);
        }
        writer.finishLengthDelimited(kvlistStart, writer.pos - kvlistStartPos);
    }
    // Else: unsupported type, write nothing
}
exports.writeAnyValue = writeAnyValue;
/**
 * Write an InstrumentationScope message.
 *
 * Proto fields (InstrumentationScope):
 *   1  name     string  (wire type 2)
 *   2  version  string  (wire type 2)
 */
function writeInstrumentationScope(writer, scope, fieldNumber) {
    writer.writeTag(fieldNumber, 2);
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    // name (field 1, string)
    writer.writeTag(1, 2);
    writer.writeString(scope.name);
    // version (field 2, string) - skip if empty
    if (scope.version) {
        writer.writeTag(2, 2);
        writer.writeString(scope.version);
    }
    if (scope.attributes) {
        // attributes (field 3, repeated KeyValue)
        writeAttributes(writer, scope.attributes, 3);
    }
    if (scope.droppedAttributesCount) {
        // dropped_attributes_count (field 4, uint32)
        writer.writeTag(4, 0);
        writer.writeVarint(scope.droppedAttributesCount);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
exports.writeInstrumentationScope = writeInstrumentationScope;
/**
 * Write a Resource message and its enclosing tag.
 *
 * Proto fields (Resource):
 *   1  attributes                repeated KeyValue  (wire type 2)
 *   2  dropped_attributes_count  uint32             (wire type 0)
 */
function writeResource(writer, resource, fieldNumber) {
    writer.writeTag(fieldNumber, 2);
    const resourceStart = writer.startLengthDelimited();
    const resourceStartPos = writer.pos;
    // attributes (field 1, repeated KeyValue)
    if (resource.attributes) {
        writeAttributes(writer, resource.attributes, 1);
    }
    // dropped_attributes_count (field 2, uint32) - set to 0 as we don't track this
    writer.writeTag(2, 0);
    writer.writeVarint(0);
    writer.finishLengthDelimited(resourceStart, writer.pos - resourceStartPos);
}
exports.writeResource = writeResource;
//# sourceMappingURL=common-serializer.js.map