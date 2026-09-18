export function defineToolInputGuardrail(args) {
    return {
        type: 'tool_input',
        name: args.name,
        run: args.run,
    };
}
export function defineToolOutputGuardrail(args) {
    return {
        type: 'tool_output',
        name: args.name,
        run: args.run,
    };
}
export const ToolGuardrailFunctionOutputFactory = {
    allow(outputInfo) {
        return {
            behavior: { type: 'allow' },
            outputInfo,
        };
    },
    rejectContent(message, outputInfo) {
        return {
            behavior: { type: 'rejectContent', message },
            outputInfo,
        };
    },
    throwException(outputInfo) {
        return {
            behavior: { type: 'throwException' },
            outputInfo,
        };
    },
};
export function resolveToolInputGuardrails(guardrails) {
    if (!guardrails) {
        return [];
    }
    return guardrails.map((gr) => 'type' in gr && gr.type === 'tool_input'
        ? gr
        : defineToolInputGuardrail(gr));
}
export function resolveToolOutputGuardrails(guardrails) {
    if (!guardrails) {
        return [];
    }
    return guardrails.map((gr) => 'type' in gr && gr.type === 'tool_output'
        ? gr
        : defineToolOutputGuardrail(gr));
}
//# sourceMappingURL=toolGuardrail.mjs.map