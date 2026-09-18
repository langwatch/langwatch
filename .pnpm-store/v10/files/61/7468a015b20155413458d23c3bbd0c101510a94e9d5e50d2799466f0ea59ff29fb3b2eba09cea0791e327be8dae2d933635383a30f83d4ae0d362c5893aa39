import { readZodDefinition, readZodType } from "./zodCompat.mjs";
/**
 * Verifies that an input is a ZodObject without needing to have Zod at runtime since it's an
 * optional dependency.
 * @param input
 * @returns
 */
export function isZodObject(input) {
    const definition = readZodDefinition(input);
    if (!definition) {
        return false;
    }
    const type = readZodType(input);
    return type === 'object';
}
/**
 * Verifies that an input is an object with an `input` property.
 * @param input
 * @returns
 */
export function isAgentToolInput(input) {
    return (typeof input === 'object' &&
        input !== null &&
        'input' in input &&
        typeof input.input === 'string');
}
//# sourceMappingURL=typeGuards.mjs.map