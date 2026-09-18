import { NumericValue } from "@smithy/core/serde";
export function jsonReviver(key, value, context) {
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
