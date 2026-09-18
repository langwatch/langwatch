"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyTurnResult = applyTurnResult;
exports.resumeInterruptedTurn = resumeInterruptedTurn;
exports.handleInterruptedOutcome = handleInterruptedOutcome;
const turnResolution_1 = require("./turnResolution.js");
function applyTurnResult(options) {
    const { state, turnResult, agent, toolsUsed, resetTurnPersistence, onStepItems, } = options;
    onStepItems?.(turnResult);
    state._toolUseTracker.addToolUse(agent, toolsUsed);
    state._originalInput = turnResult.originalInput;
    state._generatedItems = turnResult.generatedItems;
    if (resetTurnPersistence &&
        turnResult.nextStep.type === 'next_step_run_again') {
        state.resetTurnPersistence();
    }
    state._currentStep = turnResult.nextStep;
}
async function resumeInterruptedTurn(options) {
    const { state, runner, onStepItems } = options;
    const turnResult = await (0, turnResolution_1.resolveInterruptedTurn)(state._currentAgent, state._originalInput, state._generatedItems, state._lastTurnResponse, state._lastProcessedResponse, runner, state);
    applyTurnResult({
        state,
        turnResult,
        agent: state._currentAgent,
        toolsUsed: state._lastProcessedResponse?.toolsUsed ?? [],
        resetTurnPersistence: false,
        onStepItems,
    });
    // Map next-step outcomes to interruption flow control for the outer run loop.
    // return_interruption: still waiting on approvals. rerun_turn: same turn rerun without increment.
    // advance_step: proceed without rerunning the same turn.
    if (turnResult.nextStep.type === 'next_step_interruption') {
        return { nextStep: turnResult.nextStep, action: 'return_interruption' };
    }
    if (turnResult.nextStep.type === 'next_step_run_again') {
        return { nextStep: turnResult.nextStep, action: 'rerun_turn' };
    }
    return { nextStep: turnResult.nextStep, action: 'advance_step' };
}
function handleInterruptedOutcome(options) {
    const { state, outcome, setContinuingInterruptedTurn } = options;
    switch (outcome.action) {
        case 'return_interruption':
            state._currentStep = outcome.nextStep;
            return { shouldReturn: true, shouldContinue: false };
        case 'rerun_turn':
            // Clear the step so the outer loop treats this as a new run-again without incrementing the turn.
            setContinuingInterruptedTurn(true);
            state._currentStep = undefined;
            return { shouldReturn: false, shouldContinue: true };
        case 'advance_step':
            setContinuingInterruptedTurn(false);
            state._currentStep = outcome.nextStep;
            return { shouldReturn: false, shouldContinue: false };
        default: {
            const _exhaustive = outcome.action;
            throw new Error(`Unhandled interruption outcome: ${_exhaustive}`);
        }
    }
}
//# sourceMappingURL=runLoop.js.map