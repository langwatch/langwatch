import { AutoParseableResponseFormat, AutoParseableTextFormat, AutoParseableTool } from "../lib/parser.js";
import { AutoParseableResponseTool } from "../lib/ResponsesParser.js";
import { type JSONSchema } from "../lib/jsonschema.js";
import { ResponseFormatJSONSchema } from "../resources/index.js";
import { type ResponseFormatTextJSONSchemaConfig } from "../resources/responses/responses.js";
type StandardSchemaIssue = {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | {
        readonly key: PropertyKey;
    }> | undefined;
};
type StandardSchemaResult<Output> = {
    readonly value: Output;
    readonly issues?: undefined;
} | {
    readonly issues: ReadonlyArray<StandardSchemaIssue>;
};
type StandardJSONSchemaOptions = {
    readonly target: 'draft-07';
    readonly libraryOptions?: Record<string, unknown> | undefined;
};
type StandardSchemaLike<Input = unknown, Output = Input> = {
    readonly '~standard': {
        readonly version: 1;
        readonly vendor: string;
        readonly types?: {
            readonly input: Input;
            readonly output: Output;
        } | undefined;
        readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
        readonly jsonSchema?: {
            readonly input: (options: StandardJSONSchemaOptions) => Record<string, unknown>;
            readonly output?: (options: StandardJSONSchemaOptions) => Record<string, unknown>;
        } | undefined;
    };
};
type InferStandardOutput<Schema extends StandardSchemaLike> = [
    NonNullable<Schema['~standard']['types']>
] extends [never] ? unknown : NonNullable<Schema['~standard']['types']> extends {
    readonly output: infer Output;
} ? Output : unknown;
type StandardSchemaJSONSchemaProps = {
    /**
     * A JSON Schema override for Standard Schema implementations that do not
     * expose `~standard.jsonSchema.input()`.
     */
    schema?: JSONSchema | Record<string, unknown> | undefined;
};
type StandardResponseFormatProps = Omit<ResponseFormatJSONSchema.JSONSchema, 'schema' | 'strict' | 'name'> & StandardSchemaJSONSchemaProps;
type StandardTextFormatProps = Omit<ResponseFormatTextJSONSchemaConfig, 'schema' | 'type' | 'strict' | 'name'> & StandardSchemaJSONSchemaProps;
type StandardToolFunction<Parameters extends StandardSchemaLike> = (args: InferStandardOutput<Parameters>) => unknown | Promise<unknown>;
type StandardToolOptions<Parameters extends StandardSchemaLike> = {
    name: string;
    parameters: Parameters;
    /**
     * A JSON Schema override for Standard Schema implementations that do not
     * expose `~standard.jsonSchema.input()`.
     */
    schema?: JSONSchema | Record<string, unknown> | undefined;
    function?: StandardToolFunction<Parameters> | undefined;
    description?: string | undefined;
};
type StandardToolReturnOptions<Parameters extends StandardSchemaLike, Function extends StandardToolFunction<Parameters> | undefined> = {
    arguments: InferStandardOutput<Parameters>;
    name: string;
    function: Function;
};
/**
 * Creates a chat completion `JSONSchema` response format from a Standard
 * Schema validator.
 *
 * The helper uses `~standard.jsonSchema.input()` for the model-facing schema
 * and `~standard.validate()` for parsed output. Validation must be
 * synchronous because the SDK's parse helpers are synchronous.
 */
export declare function standardResponseFormat<Schema extends StandardSchemaLike>(standardSchema: Schema, name: string, props?: StandardResponseFormatProps): AutoParseableResponseFormat<InferStandardOutput<Schema>>;
/**
 * Creates a Responses API `json_schema` text format from a Standard Schema
 * validator.
 */
export declare function standardTextFormat<Schema extends StandardSchemaLike>(standardSchema: Schema, name: string, props?: StandardTextFormatProps): AutoParseableTextFormat<InferStandardOutput<Schema>>;
/**
 * Creates a chat completion `function` tool from a Standard Schema
 * validator.
 */
export declare function standardFunction<Parameters extends StandardSchemaLike, Function extends StandardToolFunction<Parameters>>(options: StandardToolOptions<Parameters> & {
    function: Function;
}): AutoParseableTool<StandardToolReturnOptions<Parameters, Function>>;
export declare function standardFunction<Parameters extends StandardSchemaLike>(options: StandardToolOptions<Parameters> & {
    function?: undefined;
}): AutoParseableTool<StandardToolReturnOptions<Parameters, undefined>>;
export declare function standardFunction<Parameters extends StandardSchemaLike>(options: StandardToolOptions<Parameters>): AutoParseableTool<StandardToolReturnOptions<Parameters, StandardToolFunction<Parameters> | undefined>>;
/**
 * Creates a Responses API `function` tool from a Standard Schema validator.
 */
export declare function standardResponsesFunction<Parameters extends StandardSchemaLike, Function extends StandardToolFunction<Parameters>>(options: StandardToolOptions<Parameters> & {
    function: Function;
}): AutoParseableResponseTool<StandardToolReturnOptions<Parameters, Function>>;
export declare function standardResponsesFunction<Parameters extends StandardSchemaLike>(options: StandardToolOptions<Parameters> & {
    function?: undefined;
}): AutoParseableResponseTool<StandardToolReturnOptions<Parameters, undefined>>;
export declare function standardResponsesFunction<Parameters extends StandardSchemaLike>(options: StandardToolOptions<Parameters>): AutoParseableResponseTool<StandardToolReturnOptions<Parameters, StandardToolFunction<Parameters> | undefined>>;
export {};
//# sourceMappingURL=standard-schema.d.ts.map