import { readZodDefinition, readZodType } from "./zodCompat.mjs";
const JSON_SCHEMA_DRAFT_07 = 'http://json-schema.org/draft-07/schema#';
const OPTIONAL_WRAPPERS = new Set(['optional']);
const DECORATOR_WRAPPERS = new Set([
    'brand',
    'branded',
    'catch',
    'default',
    'effects',
    'pipeline',
    'pipe',
    'prefault',
    'readonly',
    'refinement',
    'transform',
]);
// Primitive leaf nodes map 1:1 to JSON Schema types; everything else is handled
// by the specialised builders further down.
const SIMPLE_TYPE_MAPPING = {
    string: { type: 'string' },
    number: { type: 'number' },
    bigint: { type: 'integer' },
    boolean: { type: 'boolean' },
    date: { type: 'string', format: 'date-time' },
};
export function hasJsonSchemaObjectShape(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.type === 'object' &&
        'properties' in value &&
        'additionalProperties' in value);
}
export function zodJsonSchemaCompat(input) {
    // Attempt to build an object schema from Zod's internal shape. If we cannot
    // understand the structure we return undefined, letting callers raise a
    // descriptive error instead of emitting an invalid schema.
    const schema = buildObjectSchema(input);
    if (!schema) {
        return undefined;
    }
    if (!Array.isArray(schema.required)) {
        schema.required = [];
    }
    if (typeof schema.additionalProperties === 'undefined') {
        schema.additionalProperties = false;
    }
    if (typeof schema.$schema !== 'string') {
        schema.$schema = JSON_SCHEMA_DRAFT_07;
    }
    return schema;
}
function buildObjectSchema(value) {
    const shape = readShape(value);
    if (!shape) {
        return undefined;
    }
    const properties = {};
    const required = [];
    for (const [key, field] of Object.entries(shape)) {
        const { schema, optional } = convertProperty(field);
        if (!schema) {
            return undefined;
        }
        properties[key] = schema;
        if (!optional) {
            required.push(key);
        }
    }
    return { type: 'object', properties, required, additionalProperties: false };
}
function convertProperty(value) {
    // Remove wrapper decorators (brand, transform, etc.) before attempting to
    // classify the node, tracking whether we crossed an `optional` boundary so we
    // can populate the `required` array later.
    let current = unwrapDecorators(value);
    let optional = false;
    while (OPTIONAL_WRAPPERS.has(readZodType(current) ?? '')) {
        optional = true;
        const def = readZodDefinition(current);
        const next = unwrapDecorators(def?.innerType);
        if (!next || next === current) {
            break;
        }
        current = next;
    }
    return { schema: convertSchema(current), optional };
}
function convertSchema(value) {
    if (value === undefined) {
        return undefined;
    }
    const unwrapped = unwrapDecorators(value);
    const type = readZodType(unwrapped);
    const def = readZodDefinition(unwrapped);
    if (!type) {
        return undefined;
    }
    if (type in SIMPLE_TYPE_MAPPING) {
        return SIMPLE_TYPE_MAPPING[type];
    }
    switch (type) {
        case 'object':
            return buildObjectSchema(unwrapped);
        case 'array':
            return buildArraySchema(def);
        case 'tuple':
            return buildTupleSchema(def);
        case 'union':
            return buildUnionSchema(def);
        case 'intersection':
            return buildIntersectionSchema(def);
        case 'literal':
            return buildLiteral(def);
        case 'enum':
        case 'nativeenum':
            return buildEnum(def);
        case 'record':
            return buildRecordSchema(def);
        case 'map':
            return buildMapSchema(def);
        case 'set':
            return buildSetSchema(def);
        case 'nullable':
            return buildNullableSchema(def);
        default:
            return undefined;
    }
}
// --- JSON Schema builders -------------------------------------------------
function buildArraySchema(def) {
    const items = convertSchema(extractFirst(def, 'element', 'items', 'type'));
    return items ? { type: 'array', items } : undefined;
}
function buildTupleSchema(def) {
    const items = coerceArray(def?.items)
        .map((item) => convertSchema(item))
        .filter(Boolean);
    if (!items.length) {
        return undefined;
    }
    const schema = {
        type: 'array',
        items,
        minItems: items.length,
    };
    if (!def?.rest) {
        schema.maxItems = items.length;
    }
    return schema;
}
function buildUnionSchema(def) {
    const options = coerceArray(def?.options ?? def?.schemas)
        .map((option) => convertSchema(option))
        .filter(Boolean);
    return options.length ? { anyOf: options } : undefined;
}
function buildIntersectionSchema(def) {
    const left = convertSchema(def?.left);
    const right = convertSchema(def?.right);
    return left && right ? { allOf: [left, right] } : undefined;
}
function buildRecordSchema(def) {
    const valueSchema = convertSchema(def?.valueType ?? def?.values);
    return valueSchema
        ? { type: 'object', additionalProperties: valueSchema }
        : undefined;
}
function buildMapSchema(def) {
    const valueSchema = convertSchema(def?.valueType ?? def?.values);
    return valueSchema ? { type: 'array', items: valueSchema } : undefined;
}
function buildSetSchema(def) {
    const valueSchema = convertSchema(def?.valueType);
    return valueSchema
        ? { type: 'array', items: valueSchema, uniqueItems: true }
        : undefined;
}
function buildNullableSchema(def) {
    const inner = convertSchema(def?.innerType ?? def?.type);
    return inner ? { anyOf: [inner, { type: 'null' }] } : undefined;
}
function unwrapDecorators(value) {
    let current = value;
    while (DECORATOR_WRAPPERS.has(readZodType(current) ?? '')) {
        const def = readZodDefinition(current);
        const next = def?.innerType ??
            def?.schema ??
            def?.base ??
            def?.type ??
            def?.wrapped ??
            def?.underlying;
        if (!next || next === current) {
            return current;
        }
        current = next;
    }
    return current;
}
function extractFirst(def, ...keys) {
    if (!def) {
        return undefined;
    }
    for (const key of keys) {
        if (key in def && def[key] !== undefined) {
            return def[key];
        }
    }
    return undefined;
}
function coerceArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    return value === undefined ? [] : [value];
}
function buildLiteral(def) {
    if (!def) {
        return undefined;
    }
    const literal = extractFirst(def, 'value', 'literal');
    if (literal === undefined) {
        return undefined;
    }
    return {
        const: literal,
        type: literal === null ? 'null' : typeof literal,
    };
}
function buildEnum(def) {
    if (!def) {
        return undefined;
    }
    if (Array.isArray(def.values)) {
        return { enum: def.values };
    }
    if (Array.isArray(def.options)) {
        return { enum: def.options };
    }
    if (def.values && typeof def.values === 'object') {
        return { enum: Object.values(def.values) };
    }
    if (def.enum && typeof def.enum === 'object') {
        return { enum: Object.values(def.enum) };
    }
    return undefined;
}
function readShape(input) {
    if (typeof input !== 'object' || input === null) {
        return undefined;
    }
    const candidate = input;
    if (candidate.shape && typeof candidate.shape === 'object') {
        return candidate.shape;
    }
    if (typeof candidate.shape === 'function') {
        try {
            return candidate.shape();
        }
        catch (_error) {
            return undefined;
        }
    }
    const def = readZodDefinition(candidate);
    const shape = def?.shape;
    if (shape && typeof shape === 'object') {
        return shape;
    }
    if (typeof shape === 'function') {
        try {
            return shape();
        }
        catch (_error) {
            return undefined;
        }
    }
    return undefined;
}
//# sourceMappingURL=zodJsonSchemaCompat.mjs.map