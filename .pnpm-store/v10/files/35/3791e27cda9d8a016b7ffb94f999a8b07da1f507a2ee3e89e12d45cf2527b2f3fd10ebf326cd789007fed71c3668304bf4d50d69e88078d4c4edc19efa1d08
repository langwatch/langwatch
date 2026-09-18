"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zodResponseFormat = zodResponseFormat;
exports.zodTextFormat = zodTextFormat;
exports.zodFunction = zodFunction;
exports.zodResponsesFunction = zodResponsesFunction;
exports.zodRealtimeFunction = zodRealtimeFunction;
const tslib_1 = require("../internal/tslib.js");
const z4 = tslib_1.__importStar(require("zod/v4"));
const parser_1 = require("../lib/parser.js");
const zod_to_json_schema_1 = require("../_vendor/zod-to-json-schema/index.js");
const ResponsesParser_1 = require("../lib/ResponsesParser.js");
const transform_1 = require("../lib/transform.js");
function encodeSchemaDefinitionRefToken(token) {
    return encodeURIComponent(token.replace(/~/g, '~0').replace(/\//g, '~1'));
}
function validateSchemaDefinitions(schemaDefinitions) {
    if (schemaDefinitions && Object.prototype.hasOwnProperty.call(schemaDefinitions, '__proto__')) {
        throw new Error('schemaDefinitions cannot include "__proto__" as a definition name');
    }
}
function escapeSchemaDefinitionRefs(schema, schemaDefinitions) {
    const refReplacements = new Map(Object.keys(schemaDefinitions ?? {}).map((name) => [
        `#/definitions/${name}`,
        `#/definitions/${encodeSchemaDefinitionRefToken(name)}`,
    ]));
    const visit = (value) => {
        if (!value || typeof value !== 'object')
            return;
        if (Array.isArray(value)) {
            for (const child of value)
                visit(child);
            return;
        }
        const record = value;
        const ref = record['$ref'];
        if (typeof ref === 'string') {
            record['$ref'] = refReplacements.get(ref) ?? ref;
        }
        for (const child of Object.values(record))
            visit(child);
    };
    visit(schema);
    return schema;
}
function getZodV3RootName(name, schemaDefinitions) {
    let rootName = name;
    while (schemaDefinitions && Object.prototype.hasOwnProperty.call(schemaDefinitions, rootName)) {
        rootName = `${rootName}_root`;
    }
    return rootName;
}
function zodV3ToJsonSchema(schema, options) {
    const rootName = getZodV3RootName(options.name, options.schemaDefinitions);
    const jsonSchema = (0, zod_to_json_schema_1.zodToJsonSchema)(schema, {
        openaiStrictMode: true,
        name: rootName,
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        nullableStrategy: 'property',
        ...(options.schemaDefinitions ?
            { definitions: options.schemaDefinitions }
            : undefined),
    });
    return escapeSchemaDefinitionRefs(jsonSchema, options.schemaDefinitions);
}
function zodV4ToJsonSchema(schema, options = {}) {
    const metadata = options.schemaDefinitions ? z4.registry() : undefined;
    for (const [name, definition] of Object.entries(options.schemaDefinitions ?? {})) {
        metadata?.add(definition, { id: name });
    }
    const jsonSchema = z4.toJSONSchema(schema, {
        target: 'draft-7',
        ...(metadata ? { metadata } : undefined),
        override: ({ zodSchema, jsonSchema }) => {
            const def = zodSchema._zod.def;
            if (def.type === 'union' && 'discriminator' in def && Array.isArray(jsonSchema.oneOf)) {
                if (jsonSchema.anyOf !== undefined) {
                    throw new Error('Zod discriminated union generated both `anyOf` and `oneOf`, which cannot be represented in an OpenAI strict schema');
                }
                // Discriminator values are mutually exclusive, so anyOf preserves the
                // union while staying inside the API's supported JSON Schema subset.
                jsonSchema.anyOf = jsonSchema.oneOf;
                delete jsonSchema.oneOf;
            }
        },
    });
    const escapedSchema = escapeSchemaDefinitionRefs(jsonSchema, options.schemaDefinitions);
    return (0, transform_1.toStrictJsonSchema)(escapedSchema);
}
function zodV3ToNonStrictJsonSchema(schema, options) {
    return (0, zod_to_json_schema_1.zodToJsonSchema)(schema, {
        name: options.name,
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        pipeStrategy: 'input',
    });
}
function zodV4ToNonStrictJsonSchema(schema) {
    return z4.toJSONSchema(schema, {
        target: 'draft-7',
        io: 'input',
    });
}
function isZodV4(zodObject) {
    return '_zod' in zodObject;
}
function parseZodObject(zodObject, content) {
    const parsed = JSON.parse(content);
    const parser = zodObject.parse;
    if (typeof parser === 'function') {
        return parser.call(zodObject, parsed);
    }
    return z4.parse(zodObject, parsed);
}
/**
 * Creates a chat completion `JSONSchema` response format object from
 * the given Zod schema.
 *
 * If this is passed to the `.parse()`, `.stream()` or `.runTools()`
 * chat completion methods then the response message will contain a
 * `.parsed` property that is the result of parsing the content with
 * the given Zod object.
 *
 * ```ts
 * const completion = await client.chat.completions.parse({
 *    model: 'gpt-4o-2024-08-06',
 *    messages: [
 *      { role: 'system', content: 'You are a helpful math tutor.' },
 *      { role: 'user', content: 'solve 8x + 31 = 2' },
 *    ],
 *    response_format: zodResponseFormat(
 *      z.object({
 *        steps: z.array(z.object({
 *          explanation: z.string(),
 *          answer: z.string(),
 *        })),
 *        final_answer: z.string(),
 *      }),
 *      'math_answer',
 *    ),
 *  });
 *  const message = completion.choices[0]?.message;
 *  if (message?.parsed) {
 *    console.log(message.parsed);
 *    console.log(message.parsed.final_answer);
 * }
 * ```
 *
 * This can be passed directly to the `.create()` method but will not
 * result in any automatic parsing, you'll have to parse the response yourself.
 */
function zodResponseFormat(zodObject, name, props) {
    const zodSchema = zodObject;
    const { schemaDefinitions, ...responseFormatProps } = props ?? {};
    validateSchemaDefinitions(schemaDefinitions);
    return (0, parser_1.makeParseableResponseFormat)({
        type: 'json_schema',
        json_schema: {
            ...responseFormatProps,
            name,
            strict: true,
            schema: isZodV4(zodSchema) ?
                zodV4ToJsonSchema(zodSchema, { schemaDefinitions })
                : zodV3ToJsonSchema(zodSchema, { name, schemaDefinitions }),
        },
    }, (content) => parseZodObject(zodObject, content));
}
function zodTextFormat(zodObject, name, props) {
    const zodSchema = zodObject;
    return (0, parser_1.makeParseableTextFormat)({
        type: 'json_schema',
        ...props,
        name,
        strict: true,
        schema: isZodV4(zodSchema) ? zodV4ToJsonSchema(zodSchema) : zodV3ToJsonSchema(zodSchema, { name }),
    }, (content) => parseZodObject(zodObject, content));
}
/**
 * Creates a chat completion `function` tool that can be invoked
 * automatically by the chat completion `.runTools()` method or automatically
 * parsed by `.parse()` / `.stream()`.
 */
function zodFunction(options) {
    const zodSchema = options.parameters;
    // @ts-expect-error TODO
    return (0, parser_1.makeParseableTool)({
        type: 'function',
        function: {
            name: options.name,
            parameters: isZodV4(zodSchema) ?
                zodV4ToJsonSchema(zodSchema)
                : zodV3ToJsonSchema(zodSchema, { name: options.name }),
            strict: true,
            ...(options.description ? { description: options.description } : undefined),
        },
    }, {
        callback: options.function,
        parser: (args) => parseZodObject(options.parameters, args),
    });
}
function zodResponsesFunction(options) {
    const zodSchema = options.parameters;
    return (0, ResponsesParser_1.makeParseableResponseTool)({
        type: 'function',
        name: options.name,
        parameters: isZodV4(zodSchema) ?
            zodV4ToJsonSchema(zodSchema)
            : zodV3ToJsonSchema(zodSchema, { name: options.name }),
        strict: true,
        ...(options.description ? { description: options.description } : undefined),
    }, {
        callback: options.function,
        parser: (args) => parseZodObject(options.parameters, args),
    });
}
/**
 * Creates a Realtime API `function` tool definition from the given Zod schema.
 *
 * Unlike {@link zodResponsesFunction}, this helper does not add `strict`
 * because Realtime function tools do not support that field.
 *
 * This helper only creates the tool definition. Parse function-call arguments
 * from Realtime events with the original Zod schema.
 */
function zodRealtimeFunction(options) {
    const zodSchema = options.parameters;
    return {
        type: 'function',
        name: options.name,
        parameters: isZodV4(zodSchema) ?
            zodV4ToNonStrictJsonSchema(zodSchema)
            : zodV3ToNonStrictJsonSchema(zodSchema, { name: options.name }),
        ...(options.description ? { description: options.description } : undefined),
    };
}
//# sourceMappingURL=zod.js.map