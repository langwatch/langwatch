import { ToolInputGuardrailTripwireTriggered, ToolOutputGuardrailTripwireTriggered, } from "../errors.mjs";
function normalizeBehavior(output) {
    return output.behavior ?? { type: 'allow' };
}
export async function runToolInputGuardrails({ guardrails, context, agent, toolCall, onResult, }) {
    const list = guardrails ?? [];
    for (const guardrail of list) {
        const output = await guardrail.run({
            context,
            agent,
            toolCall,
        });
        const behavior = normalizeBehavior(output);
        const result = {
            guardrail: { type: 'tool_input', name: guardrail.name },
            output: { ...output, behavior },
        };
        onResult?.(result);
        if (behavior.type === 'rejectContent') {
            return { type: 'reject', message: behavior.message };
        }
        if (behavior.type === 'throwException') {
            throw new ToolInputGuardrailTripwireTriggered(`Tool input guardrail triggered: ${guardrail.name}`, result);
        }
    }
    return { type: 'allow' };
}
export async function runToolOutputGuardrails({ guardrails, context, agent, toolCall, toolOutput, onResult, }) {
    const list = guardrails ?? [];
    let finalOutput = toolOutput;
    for (const guardrail of list) {
        const output = await guardrail.run({
            context,
            agent,
            toolCall,
            output: toolOutput,
        });
        const behavior = normalizeBehavior(output);
        const result = {
            guardrail: { type: 'tool_output', name: guardrail.name },
            output: { ...output, behavior },
        };
        onResult?.(result);
        if (behavior.type === 'rejectContent') {
            finalOutput = behavior.message;
            break;
        }
        if (behavior.type === 'throwException') {
            throw new ToolOutputGuardrailTripwireTriggered(`Tool output guardrail triggered: ${guardrail.name}`, result);
        }
    }
    return finalOutput;
}
//# sourceMappingURL=toolGuardrails.mjs.map