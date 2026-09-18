"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeTool = serializeTool;
exports.serializeHandoff = serializeHandoff;
const errors_1 = require("../errors.js");
function isComputerInstance(value) {
    return (!!value &&
        typeof value === 'object' &&
        'environment' in value &&
        'dimensions' in value);
}
function serializeTool(tool) {
    if (tool.type === 'function') {
        return {
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: tool.strict,
        };
    }
    if (tool.type === 'computer') {
        // When a computer is created lazily via an initializer, serializeTool can be called before initialization (e.g., manual serialize without running the agent).
        if (!isComputerInstance(tool.computer)) {
            throw new errors_1.UserError('Computer tool is not initialized for serialization. Call resolveComputer({ tool, runContext }) first (for example, when building a model payload outside Runner.run).');
        }
        return {
            type: 'computer',
            name: tool.name,
            environment: tool.computer.environment,
            dimensions: tool.computer.dimensions,
        };
    }
    if (tool.type === 'shell') {
        return {
            type: 'shell',
            name: tool.name,
        };
    }
    if (tool.type === 'apply_patch') {
        return {
            type: 'apply_patch',
            name: tool.name,
        };
    }
    return {
        type: 'hosted_tool',
        name: tool.name,
        providerData: tool.providerData,
    };
}
function serializeHandoff(h) {
    return {
        toolName: h.toolName,
        toolDescription: h.toolDescription,
        inputJsonSchema: h.inputJsonSchema,
        strictJsonSchema: h.strictJsonSchema,
    };
}
//# sourceMappingURL=serialize.js.map