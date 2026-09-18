import { Agent, AgentOutputType } from './agent';
import { InputGuardrailResult, OutputGuardrailMetadata, OutputGuardrailResult } from './guardrail';
import { ToolInputGuardrailResult, ToolOutputGuardrailResult } from './toolGuardrail';
import { RunContext } from './runContext';
import { RunState } from './runState';
import { TextOutput } from './types';
import * as protocol from './types/protocol';
/**
 * Base class for all errors thrown by the library.
 */
export declare abstract class AgentsError extends Error {
    state?: RunState<any, Agent<any, any>>;
    constructor(message: string, state?: RunState<any, Agent<any, any>>);
}
/**
 * System error thrown when the library encounters an error that is not caused by the user's
 * misconfiguration.
 */
export declare class SystemError extends AgentsError {
}
/**
 * Error thrown when the maximum number of turns is exceeded.
 */
export declare class MaxTurnsExceededError extends AgentsError {
}
/**
 * Error thrown when a model behavior is unexpected.
 */
export declare class ModelBehaviorError extends AgentsError {
}
/**
 * Context from tool invocation that failed validation.
 */
export type ToolInvocationErrorContext = {
    /** The run context at the time of the error. */
    runContext?: RunContext<any>;
    /** The invalid tool input produced by the model. */
    input?: string;
    /** The details of the tool call made by the model. */
    details?: {
        toolCall: protocol.FunctionCallItem;
    };
};
/**
 * Error thrown when a model produces invalid tool input.
 */
export declare class InvalidToolInputError extends ModelBehaviorError {
    /** The original error thrown during validation, if any. */
    originalError?: unknown;
    /** Context from the tool invocation that failed. */
    toolInvocation?: ToolInvocationErrorContext;
    constructor(message: string, state?: RunState<any, Agent<any, any>>, originalError?: unknown, toolInvocation?: ToolInvocationErrorContext);
}
/**
 * Error thrown when the error is caused by the library user's misconfiguration.
 */
export declare class UserError extends AgentsError {
}
/**
 * Error thrown when a guardrail execution fails.
 */
export declare class GuardrailExecutionError extends AgentsError {
    error: Error;
    constructor(message: string, error: Error, state?: RunState<any, Agent<any, any>>);
}
/**
 * Error thrown when a tool call fails.
 */
export declare class ToolCallError extends AgentsError {
    error: Error;
    constructor(message: string, error: Error, state?: RunState<any, Agent<any, any>>);
}
/**
 * Error thrown when an input guardrail tripwire is triggered.
 */
export declare class InputGuardrailTripwireTriggered extends AgentsError {
    result: InputGuardrailResult;
    constructor(message: string, result: InputGuardrailResult, state?: RunState<any, any>);
}
/**
 * Error thrown when an output guardrail tripwire is triggered.
 */
export declare class OutputGuardrailTripwireTriggered<TMeta extends OutputGuardrailMetadata, TOutputType extends AgentOutputType = TextOutput> extends AgentsError {
    result: OutputGuardrailResult<TMeta, TOutputType>;
    constructor(message: string, result: OutputGuardrailResult<TMeta, TOutputType>, state?: RunState<any, any>);
}
/**
 * Error thrown when a tool input guardrail tripwire is triggered.
 */
export declare class ToolInputGuardrailTripwireTriggered extends AgentsError {
    result: ToolInputGuardrailResult;
    constructor(message: string, result: ToolInputGuardrailResult, state?: RunState<any, any>);
}
/**
 * Error thrown when a tool output guardrail tripwire is triggered.
 */
export declare class ToolOutputGuardrailTripwireTriggered extends AgentsError {
    result: ToolOutputGuardrailResult;
    constructor(message: string, result: ToolOutputGuardrailResult, state?: RunState<any, any>);
}
