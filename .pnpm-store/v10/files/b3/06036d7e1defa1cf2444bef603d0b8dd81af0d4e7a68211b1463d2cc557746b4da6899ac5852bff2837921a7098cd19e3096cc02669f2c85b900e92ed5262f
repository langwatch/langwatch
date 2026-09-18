import { MaxTurnsExceededError } from "../errors.mjs";
import logger from "../logger.mjs";
import { buildInputGuardrailDefinitions, runInputGuardrails, splitInputGuardrails, } from "./guardrails.mjs";
import { getTurnInput } from "./items.mjs";
import { prepareAgentArtifacts } from "./modelPreparation.mjs";
export async function prepareTurn(options) {
    const { state, input, generatedItems, isResumedState, preserveTurnPersistenceOnResume, continuingInterruptedTurn, serverConversationTracker, inputGuardrailDefs, guardrailHandlers, emitAgentStart, } = options;
    const artifacts = await prepareAgentArtifacts(state);
    const { isResumingFromInterruption } = beginTurn(state, {
        isResumedState,
        preserveTurnPersistenceOnResume,
        continuingInterruptedTurn,
    });
    if (state._currentTurn > state._maxTurns) {
        state._currentAgentSpan?.setError({
            message: 'Max turns exceeded',
            data: { max_turns: state._maxTurns },
        });
        throw new MaxTurnsExceededError(`Max turns (${state._maxTurns}) exceeded`, state);
    }
    logger.debug(`Running agent ${state._currentAgent.name} (turn ${state._currentTurn})`);
    const { parallelGuardrailPromise } = await runInputGuardrailsForTurn(state, inputGuardrailDefs, isResumingFromInterruption, guardrailHandlers);
    const turnInput = serverConversationTracker
        ? serverConversationTracker.prepareInput(input, generatedItems)
        : getTurnInput(input, generatedItems);
    if (state._noActiveAgentRun) {
        state._currentAgent.emit('agent_start', state._context, state._currentAgent, turnInput);
        emitAgentStart?.(state._context, state._currentAgent, turnInput);
    }
    return {
        artifacts,
        turnInput,
        parallelGuardrailPromise,
    };
}
async function runInputGuardrailsForTurn(state, runnerGuardrails, isResumingFromInterruption, handlers = {}) {
    if (state._currentTurn !== 1 || isResumingFromInterruption) {
        return {};
    }
    const guardrailDefs = buildInputGuardrailDefinitions(state, runnerGuardrails);
    const guardrails = splitInputGuardrails(guardrailDefs);
    if (guardrails.blocking.length > 0) {
        await runInputGuardrails(state, guardrails.blocking);
    }
    if (guardrails.parallel.length > 0) {
        handlers.onParallelStart?.();
        const promise = runInputGuardrails(state, guardrails.parallel);
        const parallelGuardrailPromise = promise.catch((err) => {
            handlers.onParallelError?.(err);
            return [];
        });
        return { parallelGuardrailPromise };
    }
    return {};
}
function beginTurn(state, options) {
    const isResumingFromInterruption = options.isResumedState && options.continuingInterruptedTurn;
    const resumingTurnInProgress = options.isResumedState && state._currentTurnInProgress === true;
    // Do not advance the turn when resuming from an interruption; the next model call is
    // still part of the same logical turn.
    if (!isResumingFromInterruption && !resumingTurnInProgress) {
        state._currentTurn++;
        if (!options.isResumedState || !options.preserveTurnPersistenceOnResume) {
            state.resetTurnPersistence();
        }
        else if (state._currentTurnPersistedItemCount > state._generatedItems.length) {
            // Reset if a stale count would skip items in subsequent turns.
            state.resetTurnPersistence();
        }
    }
    state._currentTurnInProgress = true;
    return { isResumingFromInterruption };
}
//# sourceMappingURL=turnPreparation.mjs.map