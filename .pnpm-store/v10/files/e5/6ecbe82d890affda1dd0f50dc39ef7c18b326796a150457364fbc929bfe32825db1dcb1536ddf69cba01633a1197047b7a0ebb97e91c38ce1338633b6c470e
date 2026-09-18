import type { Agent, AgentOutputType } from '../agent';
import type { RunState } from '../runState';
import type { Runner } from '../run';
import type { SingleStepResult } from './steps';
export type InterruptedTurnOutcome = {
    nextStep: SingleStepResult['nextStep'];
    action: 'return_interruption' | 'rerun_turn' | 'advance_step';
};
export type InterruptedTurnControl = {
    shouldReturn: boolean;
    shouldContinue: boolean;
};
type ApplyTurnResultOptions<TContext, TAgent extends Agent<TContext, AgentOutputType>> = {
    state: RunState<TContext, TAgent>;
    turnResult: SingleStepResult;
    agent: Agent<TContext, AgentOutputType>;
    toolsUsed: string[];
    resetTurnPersistence: boolean;
    onStepItems?: (turnResult: SingleStepResult) => void;
};
export declare function applyTurnResult<TContext, TAgent extends Agent<TContext, AgentOutputType>>(options: ApplyTurnResultOptions<TContext, TAgent>): void;
export declare function resumeInterruptedTurn<TContext, TAgent extends Agent<TContext, AgentOutputType>>(options: {
    state: RunState<TContext, TAgent>;
    runner: Runner;
    onStepItems?: (turnResult: SingleStepResult) => void;
}): Promise<InterruptedTurnOutcome>;
export declare function handleInterruptedOutcome<TContext, TAgent extends Agent<TContext, AgentOutputType>>(options: {
    state: RunState<TContext, TAgent>;
    outcome: InterruptedTurnOutcome;
    setContinuingInterruptedTurn: (value: boolean) => void;
}): InterruptedTurnControl;
export {};
