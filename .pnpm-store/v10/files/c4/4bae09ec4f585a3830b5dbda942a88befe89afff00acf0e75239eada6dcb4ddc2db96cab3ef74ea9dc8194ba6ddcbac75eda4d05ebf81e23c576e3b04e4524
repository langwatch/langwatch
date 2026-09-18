"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toFunctionToolName = toFunctionToolName;
exports.getSchemaAndParserFromInputType = getSchemaAndParserFromInputType;
exports.convertAgentOutputTypeToSerializable = convertAgentOutputTypeToSerializable;
const zod_1 = require("openai/helpers/zod");
const errors_1 = require("../errors.js");
const typeGuards_1 = require("./typeGuards.js");
const zodJsonSchemaCompat_1 = require("./zodJsonSchemaCompat.js");
const zodCompat_1 = require("./zodCompat.js");
const zodResponsesFunctionCompat = zod_1.zodResponsesFunction;
// The `.schema` payload is all we need, so a lightweight signature keeps the compiler happy.
const zodTextFormatCompat = zod_1.zodTextFormat;
// openai/helpers/zod cannot emit strict schemas for every Zod runtime
// (notably Zod v4), so we delegate to a small local converter living in
// zodJsonSchemaCompat.ts whenever its output is missing the required JSON Schema bits.
function buildJsonSchemaFromZod(inputType) {
    return (0, zodJsonSchemaCompat_1.zodJsonSchemaCompat)(inputType);
}
/**
 * Convert a string to a function tool name by replacing spaces with underscores and
 * non-alphanumeric characters with underscores.
 * @param name - The name of the tool.
 * @returns The function tool name.
 */
function toFunctionToolName(name) {
    // Replace spaces with underscores
    name = name.replace(/\s/g, '_');
    // Replace non-alphanumeric characters with underscores
    name = name.replace(/[^a-zA-Z0-9]/g, '_');
    // Ensure the name is not empty
    if (name.length === 0) {
        throw new Error('Tool name cannot be empty');
    }
    return name;
}
/**
 * Get the schema and parser from an input type. If the input type is a ZodObject, we will convert
 * it into a JSON Schema and use Zod as parser. If the input type is a JSON schema, we use the
 * JSON.parse function to get the parser.
 * @param inputType - The input type to get the schema and parser from.
 * @param name - The name of the tool.
 * @returns The schema and parser.
 */
function getSchemaAndParserFromInputType(inputType, name) {
    const parser = (input) => JSON.parse(input);
    if ((0, typeGuards_1.isZodObject)(inputType)) {
        const useFallback = (originalError) => {
            const fallbackSchema = buildJsonSchemaFromZod(inputType);
            if (fallbackSchema) {
                return {
                    schema: fallbackSchema,
                    parser: (rawInput) => inputType.parse(JSON.parse(rawInput)),
                };
            }
            const errorMessage = originalError instanceof Error
                ? ` Upstream helper error: ${originalError.message}`
                : '';
            throw new errors_1.UserError(`Unable to convert the provided Zod schema to JSON Schema. Ensure that the \`zod\` package is available at runtime or provide a JSON schema object instead.${errorMessage}`);
        };
        let formattedFunction;
        try {
            formattedFunction = zodResponsesFunctionCompat({
                name,
                parameters: (0, zodCompat_1.asZodType)(inputType),
                function: () => { }, // empty function here to satisfy the OpenAI helper
                description: '',
            });
        }
        catch (error) {
            return useFallback(error);
        }
        if ((0, zodJsonSchemaCompat_1.hasJsonSchemaObjectShape)(formattedFunction.parameters)) {
            return {
                schema: formattedFunction.parameters,
                parser: formattedFunction.$parseRaw,
            };
        }
        return useFallback();
    }
    else if (typeof inputType === 'object' && inputType !== null) {
        return {
            schema: inputType,
            parser,
        };
    }
    throw new errors_1.UserError('Input type is not a ZodObject or a valid JSON schema');
}
/**
 * Converts the agent output type provided to a serializable version
 */
function convertAgentOutputTypeToSerializable(outputType) {
    if (outputType === 'text') {
        return 'text';
    }
    if ((0, typeGuards_1.isZodObject)(outputType)) {
        const useFallback = (existing, originalError) => {
            const fallbackSchema = buildJsonSchemaFromZod(outputType);
            if (fallbackSchema) {
                return {
                    type: existing?.type ?? 'json_schema',
                    name: existing?.name ?? 'output',
                    strict: existing?.strict ?? false,
                    schema: fallbackSchema,
                };
            }
            const errorMessage = originalError instanceof Error
                ? ` Upstream helper error: ${originalError.message}`
                : '';
            throw new errors_1.UserError(`Unable to convert the provided Zod schema to JSON Schema. Ensure that the \`zod\` package is available at runtime or provide a JSON schema object instead.${errorMessage}`);
        };
        let output;
        try {
            output = zodTextFormatCompat((0, zodCompat_1.asZodType)(outputType), 'output');
        }
        catch (error) {
            return useFallback(undefined, error);
        }
        if ((0, zodJsonSchemaCompat_1.hasJsonSchemaObjectShape)(output.schema)) {
            return {
                type: output.type,
                name: output.name,
                strict: output.strict || false,
                schema: output.schema,
            };
        }
        return useFallback(output);
    }
    return outputType;
}
//# sourceMappingURL=tools.js.map