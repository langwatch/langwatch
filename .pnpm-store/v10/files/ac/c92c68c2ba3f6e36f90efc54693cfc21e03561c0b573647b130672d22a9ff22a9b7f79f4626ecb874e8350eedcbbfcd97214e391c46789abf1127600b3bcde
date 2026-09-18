import { NormalizedSchema } from "@smithy/core/schema";
const REVIVER_SYMBOL = Symbol.for("@aws-sdk/reviver");
export function needsReviver(schema) {
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
