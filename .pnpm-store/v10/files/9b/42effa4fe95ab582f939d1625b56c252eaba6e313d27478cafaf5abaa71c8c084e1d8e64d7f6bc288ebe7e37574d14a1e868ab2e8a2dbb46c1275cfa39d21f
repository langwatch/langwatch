import type { Agent } from './agent';
import type { RunContext } from './runContext';
import type * as protocol from './types/protocol';
import type { UnknownContext } from './types';
/**
 * The action a tool guardrail should take after evaluation.
 *
 * - `allow`: proceed to the next guardrail or tool execution/output handling.
 * - `rejectContent`: treat the guardrail as rejecting the call/output and short‑circuit with a message.
 * - `throwException`: escalate immediately as a tripwire to fail fast and surface diagnostics.
 */
export type ToolGuardrailBehavior = {
    type: 'allow';
} | {
    type: 'rejectContent';
    message: string;
} | {
    type: 'throwException';
};
/**
 * The output of a tool guardrail function.
 *
 * `behavior` drives runner control flow; `outputInfo` is optional, structured metadata for tracing or debugging.
 */
export interface ToolGuardrailFunctionOutput {
    /**
     * Additional data about the guardrail evaluation.
     */
    outputInfo?: any;
    /**
     * The behavior the runner should take in response to this guardrail.
     */
    behavior: ToolGuardrailBehavior;
}
export interface ToolGuardrailMetadata {
    type: 'tool_input' | 'tool_output';
    name: string;
}
export interface ToolGuardrailBase {
    name: string;
}
/**
 * Input data passed to a tool input guardrail function.
 */
export interface ToolInputGuardrailData<TContext = UnknownContext> {
    context: RunContext<TContext>;
    agent: Agent<any, any>;
    toolCall: protocol.FunctionCallItem;
}
/**
 * Input data passed to a tool output guardrail function.
 */
export interface ToolOutputGuardrailData<TContext = UnknownContext> extends ToolInputGuardrailData<TContext> {
    output: unknown;
}
export type ToolInputGuardrailFunction<TContext = UnknownContext> = (data: ToolInputGuardrailData<TContext>) => Promise<ToolGuardrailFunctionOutput>;
export type ToolOutputGuardrailFunction<TContext = UnknownContext> = (data: ToolOutputGuardrailData<TContext>) => Promise<ToolGuardrailFunctionOutput>;
export interface ToolInputGuardrailDefinition<TContext = UnknownContext> extends ToolGuardrailBase {
    type: 'tool_input';
    run: ToolInputGuardrailFunction<TContext>;
}
export interface ToolOutputGuardrailDefinition<TContext = UnknownContext> extends ToolGuardrailBase {
    type: 'tool_output';
    run: ToolOutputGuardrailFunction<TContext>;
}
export interface ToolInputGuardrailResult {
    guardrail: ToolGuardrailMetadata & {
        type: 'tool_input';
    };
    output: ToolGuardrailFunctionOutput;
}
export interface ToolOutputGuardrailResult {
    guardrail: ToolGuardrailMetadata & {
        type: 'tool_output';
    };
    output: ToolGuardrailFunctionOutput;
}
export declare function defineToolInputGuardrail<TContext = UnknownContext>(args: {
    name: string;
    run: ToolInputGuardrailFunction<TContext>;
}): ToolInputGuardrailDefinition<TContext>;
export declare function defineToolOutputGuardrail<TContext = UnknownContext>(args: {
    name: string;
    run: ToolOutputGuardrailFunction<TContext>;
}): ToolOutputGuardrailDefinition<TContext>;
export declare const ToolGuardrailFunctionOutputFactory: {
    allow(outputInfo?: any): ToolGuardrailFunctionOutput;
    rejectContent(message: string, outputInfo?: any): ToolGuardrailFunctionOutput;
    throwException(outputInfo?: any): ToolGuardrailFunctionOutput;
};
type ToolInputGuardrailInit<TContext = UnknownContext> = ToolInputGuardrailDefinition<TContext> | {
    name: string;
    run: ToolInputGuardrailFunction<TContext>;
};
type ToolOutputGuardrailInit<TContext = UnknownContext> = ToolOutputGuardrailDefinition<TContext> | {
    name: string;
    run: ToolOutputGuardrailFunction<TContext>;
};
export declare function resolveToolInputGuardrails<TContext = UnknownContext>(guardrails?: ToolInputGuardrailInit<TContext>[]): ToolInputGuardrailDefinition<TContext>[];
export declare function resolveToolOutputGuardrails<TContext = UnknownContext>(guardrails?: ToolOutputGuardrailInit<TContext>[]): ToolOutputGuardrailDefinition<TContext>[];
export {};
