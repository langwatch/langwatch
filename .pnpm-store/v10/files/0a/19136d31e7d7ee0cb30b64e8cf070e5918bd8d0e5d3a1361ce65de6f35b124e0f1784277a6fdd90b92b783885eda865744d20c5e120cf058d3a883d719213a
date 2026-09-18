import { ResponseFormatJSONSchema } from "../resources/index.mjs";
import { AutoParseableResponseFormat, AutoParseableTextFormat, AutoParseableTool } from "../lib/parser.mjs";
import { AutoParseableResponseTool } from "../lib/ResponsesParser.mjs";
import { type ResponseFormatTextJSONSchemaConfig } from "../resources/responses/responses.mjs";
import { type RealtimeFunctionTool } from "../resources/realtime/realtime.mjs";
type ZodTypeLike = ({
    _output: unknown;
} | {
    _zod: {
        output: unknown;
    };
}) & {
    parse?: (data: unknown) => unknown;
};
type InferZodType<T extends ZodTypeLike> = T extends {
    _output: infer Output;
} ? Output : T extends {
    _zod: {
        output: infer Output;
    };
} ? Output : never;
type ZodSchemaDefinitions = Record<string, ZodTypeLike>;
type ZodResponseFormatProps = Omit<ResponseFormatJSONSchema.JSONSchema, 'schema' | 'strict' | 'name'> & {
    /**
     * Schemas to extract into the generated JSON Schema definitions.
     * Use this to reuse large shared schemas instead of inlining them at every occurrence.
     */
    schemaDefinitions?: ZodSchemaDefinitions | undefined;
};
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
export declare function zodResponseFormat<ZodInput extends ZodTypeLike>(zodObject: ZodInput, name: string, props?: ZodResponseFormatProps): AutoParseableResponseFormat<InferZodType<ZodInput>>;
export declare function zodTextFormat<ZodInput extends ZodTypeLike>(zodObject: ZodInput, name: string, props?: Omit<ResponseFormatTextJSONSchemaConfig, 'schema' | 'type' | 'strict' | 'name'>): AutoParseableTextFormat<InferZodType<ZodInput>>;
/**
 * Creates a chat completion `function` tool that can be invoked
 * automatically by the chat completion `.runTools()` method or automatically
 * parsed by `.parse()` / `.stream()`.
 */
export declare function zodFunction<Parameters extends ZodTypeLike>(options: {
    name: string;
    parameters: Parameters;
    function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;
    description?: string | undefined;
}): AutoParseableTool<{
    arguments: InferZodType<Parameters>;
    name: string;
    function: (args: InferZodType<Parameters>) => unknown;
}>;
export declare function zodResponsesFunction<Parameters extends ZodTypeLike>(options: {
    name: string;
    parameters: Parameters;
    function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;
    description?: string | undefined;
}): AutoParseableResponseTool<{
    arguments: InferZodType<Parameters>;
    name: string;
    function: (args: InferZodType<Parameters>) => unknown;
}>;
/**
 * Creates a Realtime API `function` tool definition from the given Zod schema.
 *
 * Unlike {@link zodResponsesFunction}, this helper does not add `strict`
 * because Realtime function tools do not support that field.
 *
 * This helper only creates the tool definition. Parse function-call arguments
 * from Realtime events with the original Zod schema.
 */
export declare function zodRealtimeFunction<Parameters extends ZodTypeLike>(options: {
    name: string;
    parameters: Parameters;
    description?: string | undefined;
}): RealtimeFunctionTool;
export {};
//# sourceMappingURL=zod.d.mts.map