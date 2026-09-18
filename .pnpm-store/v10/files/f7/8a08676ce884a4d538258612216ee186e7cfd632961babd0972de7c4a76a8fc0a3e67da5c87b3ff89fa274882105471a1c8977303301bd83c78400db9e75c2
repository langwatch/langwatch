"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAbortError = isAbortError;
// ---------------------------------------------------------------------------
// Abort detection
// ---------------------------------------------------------------------------
function isAbortError(err) {
    if (err instanceof DOMException && err.name === "AbortError")
        return true;
    if (err instanceof Error && err.name === "AbortError")
        return true;
    if (err instanceof Error && /\babort/i.test(err.message))
        return true;
    return false;
}
