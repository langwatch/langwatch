import type { ModelItem } from './types/protocol';
import { Agent, AgentOutputType } from './agent';
import { RunContext } from './runContext';
import { AgentOutputItem, ResolvedAgentOutput, TextOutput, UnknownContext } from './types';
import type { ModelResponse } from './model';
/**
 * Definition of input/output guardrails; SDK users usually do not need to create this.
 */
export type GuardrailDefinition = InputGuardrailDefinition | OutputGuardrailDefinition;
/**
 * The output of a guardrail function.
 */
export interface GuardrailFunctionOutput {
    /**
     * Whether the tripwire was triggered. If triggered, the agent's execution will be halted.
     */
    tripwireTriggered: boolean;
    /**
     * Optional information about the guardrail's output.
     * For example, the guardrail could include information about the checks it performed and granular results.
     */
    outputInfo: any;
}
/**
 * Arguments for an input guardrail function.
 */
export interface InputGuardrailFunctionArgs<TContext = UnknownContext> {
    /**
     * The agent that is being run.
     */
    agent: Agent<any, any>;
    /**
     * The input to the agent.
     */
    input: string | ModelItem[];
    /**
     * The context of the agent run.
     */
    context: RunContext<TContext>;
}
/**
 * A guardrail that checks the input to the agent.
 */
export interface InputGuardrail {
    /**
     * The name of the guardrail.
     */
    name: string;
    /**
     * The function that performs the guardrail check
     */
    execute: InputGuardrailFunction;
    /**
     * Whether the guardrail should execute alongside the agent (true, default) or block the
     * agent until it completes (false).
     */
    runInParallel?: boolean;
}
/**
 * The result of an input guardrail execution.
 */
export interface InputGuardrailResult {
    /**
     * The metadata of the guardrail.
     */
    guardrail: InputGuardrailMetadata;
    /**
     * The output of the guardrail.
     */
    output: GuardrailFunctionOutput;
}
/**
 * The function that performs the actual input guardrail check and returns the decision on whether
 * a guardrail was triggered.
 */
export type InputGuardrailFunction = (args: InputGuardrailFunctionArgs) => Promise<GuardrailFunctionOutput>;
/**
 * Metadata for an input guardrail.
 */
export interface InputGuardrailMetadata {
    type: 'input';
    name: string;
}
/**
 * Definition of an input guardrail. SDK users usually do not need to create this.
 */
export interface InputGuardrailDefinition extends InputGuardrailMetadata {
    guardrailFunction: InputGuardrailFunction;
    runInParallel: boolean;
    run(args: InputGuardrailFunctionArgs): Promise<InputGuardrailResult>;
}
/**
 * Arguments for defining an input guardrail definition.
 */
export interface DefineInputGuardrailArgs {
    name: string;
    execute: InputGuardrailFunction;
    runInParallel?: boolean;
}
/**
 * Defines an input guardrail definition.
 */
export declare function defineInputGuardrail({ name, execute, runInParallel, }: DefineInputGuardrailArgs): InputGuardrailDefinition;
/**
 * Arguments for an output guardrail function.
 */
export interface OutputGuardrailFunctionArgs<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> {
    agent: Agent<any, any>;
    agentOutput: ResolvedAgentOutput<TOutput>;
    context: RunContext<TContext>;
    /**
     * Additional details about the agent output.
     */
    details?: {
        /** Model response associated with the output if available. */
        modelResponse?: ModelResponse;
        /** Model output items generated during the run (excluding approvals). */
        output?: AgentOutputItem[];
    };
}
/**
 * The result of an output guardrail execution.
 */
export interface OutputGuardrailResult<TMeta = OutputGuardrailMetadata, TOutput extends AgentOutputType = TextOutput> {
    /**
     * The metadata of the guardrail.
     */
    guardrail: TMeta;
    /**
     * The output of the agent that ran.
     */
    agentOutput: ResolvedAgentOutput<TOutput>;
    /**
     * The agent that ran.
     */
    agent: Agent<UnknownContext, TOutput>;
    /**
     * The output of the guardrail.
     */
    output: GuardrailFunctionOutput;
}
/**
 * A function that takes an output guardrail function arguments and returns a `GuardrailFunctionOutput`.
 */
export type OutputGuardrailFunction<TOutput extends AgentOutputType = TextOutput> = (args: OutputGuardrailFunctionArgs<UnknownContext, TOutput>) => Promise<GuardrailFunctionOutput>;
/**
 * A guardrail that checks the output of the agent.
 */
export interface OutputGuardrail<TOutput extends AgentOutputType = TextOutput> {
    /**
     * The name of the guardrail.
     */
    name: string;
    /**
     * The function that performs the guardrail check.
     */
    execute: OutputGuardrailFunction<TOutput>;
}
/**
 * Metadata for an output guardrail.
 */
export interface OutputGuardrailMetadata {
    type: 'output';
    name: string;
}
/**
 * Definition of an output guardrail.
 */
export interface OutputGuardrailDefinition<TMeta = OutputGuardrailMetadata, TOutput extends AgentOutputType = TextOutput> extends OutputGuardrailMetadata {
    guardrailFunction: OutputGuardrailFunction<TOutput>;
    run(args: OutputGuardrailFunctionArgs<UnknownContext, TOutput>): Promise<OutputGuardrailResult<TMeta, TOutput>>;
}
/**
 * Arguments for defining an output guardrail definition.
 */
export interface DefineOutputGuardrailArgs<TOutput extends AgentOutputType = TextOutput> {
    name: string;
    execute: OutputGuardrailFunction<TOutput>;
}
/**
 * Creates an output guardrail definition.
 */
export declare function defineOutputGuardrail<TOutput extends AgentOutputType = TextOutput>({ name, execute, }: DefineOutputGuardrailArgs<TOutput>): OutputGuardrailDefinition<OutputGuardrailMetadata, TOutput>;
