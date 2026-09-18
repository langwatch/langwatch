/**
 * Get the last text from the output message.
 * @param outputMessage
 * @returns
 */
export function getLastTextFromOutputMessage(outputMessage) {
    if (outputMessage.type !== 'message') {
        return undefined;
    }
    if (outputMessage.role !== 'assistant') {
        return undefined;
    }
    const lastItem = outputMessage.content[outputMessage.content.length - 1];
    if (lastItem.type !== 'output_text') {
        return undefined;
    }
    return lastItem.text;
}
/**
 * Get the last text from the output message.
 * @param output
 * @returns
 */
export function getOutputText(output) {
    if (output.output.length === 0) {
        return '';
    }
    return (getLastTextFromOutputMessage(output.output[output.output.length - 1]) || '');
}
//# sourceMappingURL=messages.mjs.map