import { Agent, AgentOutputType } from '../agent';
import { InputGuardrailDefinition, InputGuardrailResult, OutputGuardrailDefinition, OutputGuardrailMetadata } from '../guardrail';
import { RunState } from '../runState';
export type GuardrailTracker = {
    readonly pending: boolean;
    readonly failed: boolean;
    readonly error: unknown;
    markPending: () => void;
    setPromise: (promise?: Promise<InputGuardrailResult[]>) => void;
    setError: (err: unknown) => void;
    throwIfError: () => void;
    awaitCompletion: (options?: {
        suppressErrors?: boolean;
    }) => Promise<void>;
};
export declare const createGuardrailTracker: () => GuardrailTracker;
export declare function buildInputGuardrailDefinitions<TContext, TAgent extends Agent<TContext, AgentOutputType>>(state: RunState<TContext, TAgent>, runnerGuardrails: InputGuardrailDefinition[]): InputGuardrailDefinition[];
export declare function splitInputGuardrails(guardrails: InputGuardrailDefinition[]): {
    blocking: InputGuardrailDefinition[];
    parallel: InputGuardrailDefinition[];
};
export declare function runInputGuardrails<TContext, TAgent extends Agent<TContext, AgentOutputType>>(state: RunState<TContext, TAgent>, guardrails: InputGuardrailDefinition[]): Promise<InputGuardrailResult[]>;
export declare function runOutputGuardrails<TContext, TOutput extends AgentOutputType, TAgent extends Agent<TContext, TOutput>>(state: RunState<TContext, TAgent>, runnerOutputGuardrails: OutputGuardrailDefinition<OutputGuardrailMetadata, AgentOutputType<unknown>>[], output: string): Promise<void>;
