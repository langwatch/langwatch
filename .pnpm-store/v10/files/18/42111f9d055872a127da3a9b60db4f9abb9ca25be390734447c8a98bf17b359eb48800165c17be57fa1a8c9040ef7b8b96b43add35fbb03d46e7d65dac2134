"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isZodObject = isZodObject;
exports.isAgentToolInput = isAgentToolInput;
const zodCompat_1 = require("./zodCompat.js");
/**
 * Verifies that an input is a ZodObject without needing to have Zod at runtime since it's an
 * optional dependency.
 * @param input
 * @returns
 */
function isZodObject(input) {
    const definition = (0, zodCompat_1.readZodDefinition)(input);
    if (!definition) {
        return false;
    }
    const type = (0, zodCompat_1.readZodType)(input);
    return type === 'object';
}
/**
 * Verifies that an input is an object with an `input` property.
 * @param input
 * @returns
 */
function isAgentToolInput(input) {
    return (typeof input === 'object' &&
        input !== null &&
        'input' in input &&
        typeof input.input === 'string');
}
//# sourceMappingURL=typeGuards.js.map