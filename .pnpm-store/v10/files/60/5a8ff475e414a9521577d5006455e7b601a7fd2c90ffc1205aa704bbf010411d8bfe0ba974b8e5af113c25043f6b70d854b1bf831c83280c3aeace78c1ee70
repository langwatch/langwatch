import { Agent, AgentOutputType } from '../agent';
import { RunItem } from '../items';
import { RunState } from '../runState';
import type { AgentInputItem } from '../types';
import type { InputGuardrailDefinition, InputGuardrailResult } from '../guardrail';
import { ServerConversationTracker } from './conversation';
import type { AgentArtifacts } from './types';
type GuardrailHandlers = {
    onParallelStart?: () => void;
    onParallelError?: (error: unknown) => void;
};
type PreparedTurn<TContext> = {
    artifacts: AgentArtifacts<TContext>;
    turnInput: AgentInputItem[];
    parallelGuardrailPromise?: Promise<InputGuardrailResult[]>;
};
type PrepareTurnOptions<TContext, TAgent extends Agent<TContext, AgentOutputType>> = {
    state: RunState<TContext, TAgent>;
    input: string | AgentInputItem[];
    generatedItems: RunItem[];
    isResumedState: boolean;
    preserveTurnPersistenceOnResume?: boolean;
    continuingInterruptedTurn: boolean;
    serverConversationTracker?: ServerConversationTracker;
    inputGuardrailDefs: InputGuardrailDefinition[];
    guardrailHandlers?: GuardrailHandlers;
    emitAgentStart?: (context: RunState<TContext, TAgent>['_context'], agent: TAgent, turnInput: AgentInputItem[]) => void;
};
export declare function prepareTurn<TContext, TAgent extends Agent<TContext, AgentOutputType>>(options: PrepareTurnOptions<TContext, TAgent>): Promise<PreparedTurn<TContext>>;
export {};
