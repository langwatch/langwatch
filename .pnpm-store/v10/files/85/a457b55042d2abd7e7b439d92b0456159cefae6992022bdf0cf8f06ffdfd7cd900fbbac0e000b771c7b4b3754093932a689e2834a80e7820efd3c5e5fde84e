"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.standardResponseFormat = standardResponseFormat;
exports.standardTextFormat = standardTextFormat;
exports.standardFunction = standardFunction;
exports.standardResponsesFunction = standardResponsesFunction;
const error_1 = require("../error.js");
const parser_1 = require("../lib/parser.js");
const ResponsesParser_1 = require("../lib/ResponsesParser.js");
const transform_1 = require("../lib/transform.js");
function isPromiseLike(value) {
    return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}
function formatStandardSchemaIssues(issues) {
    return issues
        .map((issue) => {
        const path = issue.path
            ?.map((segment) => typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment)
            .map(String)
            .join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
    })
        .join('; ');
}
const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
function getSchemaTypes(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema))
        return undefined;
    const type = schema['type'];
    if (type === undefined) {
        return getLiteralSchemaTypes(schema);
    }
    const types = Array.isArray(type) ? type : [type];
    if (types.length === 0 ||
        !types.every((value) => typeof value === 'string' && JSON_SCHEMA_TYPES.has(value))) {
        return undefined;
    }
    return new Set(types);
}
function isJSONPrimitive(value) {
    return (value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)));
}
function getLiteralValues(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema))
        return undefined;
    const record = schema;
    if ('const' in record && isJSONPrimitive(record['const'])) {
        return [record['const']];
    }
    const enumValues = record['enum'];
    if (Array.isArray(enumValues) && enumValues.length > 0 && enumValues.every(isJSONPrimitive)) {
        return enumValues;
    }
    return undefined;
}
function getLiteralSchemaTypes(schema) {
    const literalValues = getLiteralValues(schema);
    if (!literalValues)
        return undefined;
    return new Set(literalValues.map((value) => {
        if (value === null)
            return 'null';
        return typeof value;
    }));
}
function haveDisjointLiteralValues(left, right) {
    const leftValues = getLiteralValues(left);
    const rightValues = getLiteralValues(right);
    if (!leftValues || !rightValues)
        return false;
    return leftValues.every((leftValue) => !rightValues.some((rightValue) => leftValue === rightValue));
}
function schemaTypesOverlap(left, right) {
    return (left === right || (left === 'integer' && right === 'number') || (left === 'number' && right === 'integer'));
}
function isObjectOnlySchema(schema) {
    const types = getSchemaTypes(schema);
    return types?.size === 1 && types.has('object');
}
function haveDisjointObjectDiscriminator(left, right, root) {
    if (!isObjectOnlySchema(left) || !isObjectOnlySchema(right))
        return false;
    const leftRecord = left;
    const rightRecord = right;
    const leftProperties = leftRecord['properties'];
    const rightProperties = rightRecord['properties'];
    const leftRequired = leftRecord['required'];
    const rightRequired = rightRecord['required'];
    if (!leftProperties ||
        typeof leftProperties !== 'object' ||
        Array.isArray(leftProperties) ||
        !rightProperties ||
        typeof rightProperties !== 'object' ||
        Array.isArray(rightProperties) ||
        !Array.isArray(leftRequired) ||
        !Array.isArray(rightRequired)) {
        return false;
    }
    for (const property of leftRequired) {
        if (typeof property === 'string' &&
            rightRequired.includes(property) &&
            haveDisjointLiteralValues(resolveLocalRefForExclusivity(leftProperties[property], root), resolveLocalRefForExclusivity(rightProperties[property], root))) {
            return true;
        }
    }
    return false;
}
function getClosedObjectPropertySet(schema) {
    if (!isObjectOnlySchema(schema))
        return undefined;
    const record = schema;
    const properties = record['properties'];
    const required = record['required'];
    if (record['additionalProperties'] !== false ||
        !properties ||
        typeof properties !== 'object' ||
        Array.isArray(properties) ||
        !Array.isArray(required) ||
        required.some((property) => typeof property !== 'string')) {
        return undefined;
    }
    const propertySet = new Set(Object.keys(properties));
    const requiredProperties = required;
    // A required undeclared property makes a closed branch unsatisfiable, but
    // the strictifier rejects that shape rather than representing it. Keep this
    // exclusivity proof conservative and let the normal validation path fail.
    if (requiredProperties.some((property) => !propertySet.has(property))) {
        return undefined;
    }
    return { properties: propertySet, required: requiredProperties };
}
function haveDisjointClosedObjectPropertySets(left, right) {
    const leftShape = getClosedObjectPropertySet(left);
    const rightShape = getClosedObjectPropertySet(right);
    if (!leftShape || !rightShape)
        return false;
    // If either closed branch requires a property the other branch does not
    // declare, every instance satisfying the first is rejected by the second as
    // an additional property. This proves oneOf exclusivity without widening
    // overlapping closed shapes.
    return (leftShape.required.some((property) => !rightShape.properties.has(property)) ||
        rightShape.required.some((property) => !leftShape.properties.has(property)));
}
function areMutuallyExclusive(left, right, root) {
    const leftTypes = getSchemaTypes(left);
    const rightTypes = getSchemaTypes(right);
    if (leftTypes &&
        rightTypes &&
        [...leftTypes].every((leftType) => [...rightTypes].every((rightType) => !schemaTypesOverlap(leftType, rightType)))) {
        return true;
    }
    return (haveDisjointLiteralValues(left, right) ||
        haveDisjointObjectDiscriminator(left, right, root) ||
        haveDisjointClosedObjectPropertySets(left, right));
}
function resolveLocalRefForExclusivity(schema, root, seenRefs = new Set()) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema))
        return schema;
    const record = schema;
    const ref = record['$ref'];
    if (ref !== undefined) {
        // Annotation keywords do not affect Draft 7 validation, so they are safe
        // to retain while proving the referenced branches are mutually exclusive.
        // Keep the proof conservative for every other sibling constraint.
        if (typeof ref !== 'string' || !(0, transform_1.hasOnlyRefAndAnnotations)(record)) {
            return undefined;
        }
        if (seenRefs.has(ref))
            return undefined;
        const resolved = (0, transform_1.resolveLocalRef)(root, ref);
        if (resolved === undefined)
            return undefined;
        return resolveLocalRefForExclusivity(resolved, root, new Set([...seenRefs, ref]));
    }
    if (record['allOf'] !== undefined) {
        if (!Array.isArray(record['allOf']))
            return undefined;
        const normalized = (0, transform_1.normalizeObjectAllOfForExclusivity)(record, root);
        if (normalized === undefined)
            return undefined;
        // Flattening a singleton allOf can expose a bare local ref. Feed that
        // result through this same resolver so URI-fragment decoding and the
        // existing local-ref cycle guard still apply before exclusivity analysis.
        return resolveLocalRefForExclusivity(normalized, root, seenRefs);
    }
    return schema;
}
function areOneOfBranchesMutuallyExclusive(branches, root) {
    for (let index = 0; index < branches.length; index++) {
        for (let otherIndex = index + 1; otherIndex < branches.length; otherIndex++) {
            const left = resolveLocalRefForExclusivity(branches[index], root);
            const right = resolveLocalRefForExclusivity(branches[otherIndex], root);
            if (left === undefined || right === undefined || !areMutuallyExclusive(left, right, root)) {
                return false;
            }
        }
    }
    return true;
}
function normalizeStructuredOutputSchema(schema) {
    (0, transform_1.assertNoNestedSchemaIds)(schema);
    const normalizedSchema = structuredClone(schema);
    const oneOfSchemas = [];
    const visitedSchemas = new Set();
    const visitSchema = (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return;
        const record = value;
        if (visitedSchemas.has(record))
            return;
        visitedSchemas.add(record);
        if (record['oneOf'] !== undefined) {
            if (!Array.isArray(record['oneOf'])) {
                throw new error_1.OpenAIError('Standard JSON Schema generated an invalid `oneOf`, which cannot be represented in an OpenAI strict schema');
            }
            if (record['anyOf'] !== undefined) {
                throw new error_1.OpenAIError('Standard JSON Schema generated both `anyOf` and `oneOf`, which cannot be represented in an OpenAI strict schema');
            }
            // `false` can never validate, so it cannot overlap another oneOf
            // branch. Keep it in place until the existing anyOf normalization runs
            // so local refs into surviving branch indices can be rewritten before
            // the impossible alternatives are removed.
            const possibleBranches = record['oneOf'].filter((branch) => branch !== false);
            if (!areOneOfBranchesMutuallyExclusive(possibleBranches, normalizedSchema)) {
                throw new error_1.OpenAIError('Standard JSON Schema generated a `oneOf` whose branches are not provably mutually exclusive. OpenAI strict schemas do not support `oneOf`; use `anyOf` or add a discriminator with distinct literal values.');
            }
            oneOfSchemas.push(record);
        }
        (0, transform_1.forEachJSONSchemaChild)(record, [], (child) => visitSchema(child));
    };
    visitSchema(normalizedSchema);
    (0, transform_1.rewriteLocalRefsIntoMovedOneOfBranches)(normalizedSchema);
    for (const record of oneOfSchemas) {
        record['anyOf'] = record['oneOf'];
        delete record['oneOf'];
    }
    return normalizedSchema;
}
function parseStandardSchema(standardSchema, content) {
    const result = standardSchema['~standard'].validate(JSON.parse(content));
    if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(() => undefined);
        throw new error_1.OpenAIError('Standard Schema helpers only support synchronous validation. Use a schema with a synchronous `~standard.validate()` implementation.');
    }
    if (result.issues) {
        throw new error_1.OpenAIError(`Standard Schema validation failed: ${formatStandardSchemaIssues(result.issues)}`);
    }
    return result.value;
}
function resolveStandardJSONSchema(standardSchema, schemaOverride) {
    const schema = (schemaOverride ?? standardSchema['~standard'].jsonSchema?.input({ target: 'draft-07' }));
    if (!schema) {
        throw new error_1.OpenAIError('Standard Schema helpers require a JSON Schema. Pass `schema` or use a schema that implements `~standard.jsonSchema.input()`.');
    }
    return (0, transform_1.toStrictJsonSchema)(normalizeStructuredOutputSchema(schema));
}
/**
 * Creates a chat completion `JSONSchema` response format from a Standard
 * Schema validator.
 *
 * The helper uses `~standard.jsonSchema.input()` for the model-facing schema
 * and `~standard.validate()` for parsed output. Validation must be
 * synchronous because the SDK's parse helpers are synchronous.
 */
function standardResponseFormat(standardSchema, name, props) {
    const { schema, ...formatProps } = props ?? {};
    return (0, parser_1.makeParseableResponseFormat)({
        type: 'json_schema',
        json_schema: {
            ...formatProps,
            name,
            strict: true,
            schema: resolveStandardJSONSchema(standardSchema, schema),
        },
    }, (content) => parseStandardSchema(standardSchema, content));
}
/**
 * Creates a Responses API `json_schema` text format from a Standard Schema
 * validator.
 */
function standardTextFormat(standardSchema, name, props) {
    const { schema, ...formatProps } = props ?? {};
    return (0, parser_1.makeParseableTextFormat)({
        type: 'json_schema',
        ...formatProps,
        name,
        strict: true,
        schema: resolveStandardJSONSchema(standardSchema, schema),
    }, (content) => parseStandardSchema(standardSchema, content));
}
function standardFunction(options) {
    return (0, parser_1.makeParseableTool)({
        type: 'function',
        function: {
            name: options.name,
            parameters: resolveStandardJSONSchema(options.parameters, options.schema),
            strict: true,
            ...(options.description ? { description: options.description } : undefined),
        },
    }, {
        callback: options.function,
        parser: (args) => parseStandardSchema(options.parameters, args),
    });
}
function standardResponsesFunction(options) {
    return (0, ResponsesParser_1.makeParseableResponseTool)({
        type: 'function',
        name: options.name,
        parameters: resolveStandardJSONSchema(options.parameters, options.schema),
        strict: true,
        ...(options.description ? { description: options.description } : undefined),
    }, {
        callback: options.function,
        parser: (args) => parseStandardSchema(options.parameters, args),
    });
}
//# sourceMappingURL=standard-schema.js.map