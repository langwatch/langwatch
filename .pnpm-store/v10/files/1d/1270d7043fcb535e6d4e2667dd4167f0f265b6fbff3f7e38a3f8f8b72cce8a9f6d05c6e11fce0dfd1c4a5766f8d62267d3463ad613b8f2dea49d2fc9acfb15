import { ToolInputParameters } from '../tool';
import { JsonObjectSchema, JsonSchemaDefinition, TextOutput } from '../types';
import { AgentOutputType } from '../agent';
export type FunctionToolName = string & {
    __brand?: 'ToolName';
} & {
    readonly __pattern?: '^[a-zA-Z0-9_]+$';
};
/**
 * Convert a string to a function tool name by replacing spaces with underscores and
 * non-alphanumeric characters with underscores.
 * @param name - The name of the tool.
 * @returns The function tool name.
 */
export declare function toFunctionToolName(name: string): FunctionToolName;
/**
 * Get the schema and parser from an input type. If the input type is a ZodObject, we will convert
 * it into a JSON Schema and use Zod as parser. If the input type is a JSON schema, we use the
 * JSON.parse function to get the parser.
 * @param inputType - The input type to get the schema and parser from.
 * @param name - The name of the tool.
 * @returns The schema and parser.
 */
export declare function getSchemaAndParserFromInputType<T extends ToolInputParameters>(inputType: T, name: string): {
    schema: JsonObjectSchema<any>;
    parser: (input: string) => any;
};
/**
 * Converts the agent output type provided to a serializable version
 */
export declare function convertAgentOutputTypeToSerializable(outputType: AgentOutputType): JsonSchemaDefinition | TextOutput;
