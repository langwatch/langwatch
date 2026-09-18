"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolGuardrailFunctionOutputFactory = void 0;
exports.defineToolInputGuardrail = defineToolInputGuardrail;
exports.defineToolOutputGuardrail = defineToolOutputGuardrail;
exports.resolveToolInputGuardrails = resolveToolInputGuardrails;
exports.resolveToolOutputGuardrails = resolveToolOutputGuardrails;
function defineToolInputGuardrail(args) {
    return {
        type: 'tool_input',
        name: args.name,
        run: args.run,
    };
}
function defineToolOutputGuardrail(args) {
    return {
        type: 'tool_output',
        name: args.name,
        run: args.run,
    };
}
exports.ToolGuardrailFunctionOutputFactory = {
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
function resolveToolInputGuardrails(guardrails) {
    if (!guardrails) {
        return [];
    }
    return guardrails.map((gr) => 'type' in gr && gr.type === 'tool_input'
        ? gr
        : defineToolInputGuardrail(gr));
}
function resolveToolOutputGuardrails(guardrails) {
    if (!guardrails) {
        return [];
    }
    return guardrails.map((gr) => 'type' in gr && gr.type === 'tool_output'
        ? gr
        : defineToolOutputGuardrail(gr));
}
//# sourceMappingURL=toolGuardrail.js.map