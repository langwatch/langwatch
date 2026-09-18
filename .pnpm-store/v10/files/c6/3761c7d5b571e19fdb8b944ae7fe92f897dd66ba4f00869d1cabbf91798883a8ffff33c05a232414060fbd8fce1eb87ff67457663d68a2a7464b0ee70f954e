import { Agent, AgentOutputType } from '../agent';
import { ToolInputParameters } from '../tool';
import { Handoff } from '../handoff';
import { ModelItem, StreamEvent } from './protocol';
import { TextOutput } from './aliases';
import type { ZodInfer, ZodObjectLike } from '../utils/zodCompat';
/**
 * Item representing an output in a model response.
 */
export type ResponseOutputItem = ModelItem;
/**
 * Event emitted when streaming model responses.
 */
export type ResponseStreamEvent = StreamEvent;
export type ResolveParsedToolParameters<TInputType extends ToolInputParameters> = TInputType extends ZodObjectLike ? ZodInfer<TInputType> : TInputType extends JsonObjectSchema<any> ? unknown : string;
export type ResolvedAgentOutput<TOutput extends AgentOutputType<H>, H = unknown> = TOutput extends TextOutput ? string : TOutput extends ZodObjectLike ? ZodInfer<TOutput> : TOutput extends HandoffsOutput<infer H> ? HandoffsOutput<H> : unknown extends TOutput ? any : TOutput extends Record<string, any> ? unknown : never;
export type JsonSchemaDefinitionEntry = Record<string, any>;
export type JsonObjectSchemaStrict<Properties extends Record<string, JsonSchemaDefinitionEntry>> = {
    type: 'object';
    properties: Properties;
    required: (keyof Properties)[];
    additionalProperties: false;
};
export type JsonObjectSchemaNonStrict<Properties extends Record<string, JsonSchemaDefinitionEntry>> = {
    type: 'object';
    properties: Properties;
    required: (keyof Properties)[];
    additionalProperties: true;
};
export type JsonObjectSchema<Properties extends Record<string, JsonSchemaDefinitionEntry>> = JsonObjectSchemaStrict<Properties> | JsonObjectSchemaNonStrict<Properties>;
/**
 * Wrapper around a JSON schema used for describing tool parameters.
 */
export type JsonSchemaDefinition = {
    type: 'json_schema';
    name: string;
    strict: boolean;
    schema: JsonObjectSchema<Record<string, JsonSchemaDefinitionEntry>>;
};
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
export type ExtractAgentOutput<T> = T extends Agent<any, any> ? ResolvedAgentOutput<T['outputType']> : never;
export type ExtractHandoffOutput<T> = T extends Handoff<any> ? unknown : never;
export type HandoffsOutput<H> = H extends Array<infer U> ? ExtractAgentOutput<U> | ExtractHandoffOutput<U> : never;
/**
 * Converts a snake_case string to camelCase.
 */
export type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}` ? `${T}${Capitalize<SnakeToCamelCase<U>>}` : S;
/**
 * Expands a type to include all properties of the type.
 */
export type Expand<T> = T extends infer O ? {
    [K in keyof O]: O[K];
} : never;
