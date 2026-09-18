import { UserError } from "../errors.mjs";
function isComputerInstance(value) {
    return (!!value &&
        typeof value === 'object' &&
        'environment' in value &&
        'dimensions' in value);
}
export function serializeTool(tool) {
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
            throw new UserError('Computer tool is not initialized for serialization. Call resolveComputer({ tool, runContext }) first (for example, when building a model payload outside Runner.run).');
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
export function serializeHandoff(h) {
    return {
        toolName: h.toolName,
        toolDescription: h.toolDescription,
        inputJsonSchema: h.inputJsonSchema,
        strictJsonSchema: h.strictJsonSchema,
    };
}
//# sourceMappingURL=serialize.mjs.map