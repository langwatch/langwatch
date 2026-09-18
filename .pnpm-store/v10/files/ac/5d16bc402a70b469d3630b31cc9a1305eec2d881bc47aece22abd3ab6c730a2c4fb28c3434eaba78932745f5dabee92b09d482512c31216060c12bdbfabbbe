import type { ToolInputGuardrailDefinition, ToolInputGuardrailResult, ToolOutputGuardrailDefinition, ToolOutputGuardrailResult } from '../toolGuardrail';
import type { Agent } from '../agent';
import type { RunContext } from '../runContext';
import type * as protocol from '../types/protocol';
export declare function runToolInputGuardrails<TContext, TAgent extends Agent<any, any>>({ guardrails, context, agent, toolCall, onResult, }: {
    guardrails?: ToolInputGuardrailDefinition<TContext>[];
    context: RunContext<TContext>;
    agent: TAgent;
    toolCall: protocol.FunctionCallItem;
    onResult?: (result: ToolInputGuardrailResult) => void;
}): Promise<{
    type: 'allow';
} | {
    type: 'reject';
    message: string;
}>;
export declare function runToolOutputGuardrails<TContext, TAgent extends Agent<any, any>>({ guardrails, context, agent, toolCall, toolOutput, onResult, }: {
    guardrails?: ToolOutputGuardrailDefinition<TContext>[];
    context: RunContext<TContext>;
    agent: TAgent;
    toolCall: protocol.FunctionCallItem;
    toolOutput: unknown;
    onResult?: (result: ToolOutputGuardrailResult) => void;
}): Promise<unknown>;
