/**
 * Creates a user message entry
 *
 * @param input The input message from the user.
 * @param options Any additional options that will be directly passed to the model.
 * @returns A message entry.
 */
export function user(input, options) {
    return {
        type: 'message',
        role: 'user',
        content: typeof input === 'string'
            ? [
                {
                    type: 'input_text',
                    text: input,
                },
            ]
            : input,
        providerData: options,
    };
}
/**
 * Creates a system message entry
 *
 * @param input The system prompt.
 * @param options Any additional options that will be directly passed to the model.
 * @returns A message entry.
 */
export function system(input, options) {
    return {
        type: 'message',
        role: 'system',
        content: input,
        providerData: options,
    };
}
/**
 * Creates an assistant message entry for example for multi-shot prompting
 *
 * @param content The assistant response.
 * @param options Any additional options that will be directly passed to the model.
 * @returns A message entry.
 */
export function assistant(content, options) {
    return {
        type: 'message',
        role: 'assistant',
        content: typeof content === 'string'
            ? [
                {
                    type: 'output_text',
                    text: content,
                },
            ]
            : content,
        status: 'completed',
        providerData: options,
    };
}
//# sourceMappingURL=message.mjs.map