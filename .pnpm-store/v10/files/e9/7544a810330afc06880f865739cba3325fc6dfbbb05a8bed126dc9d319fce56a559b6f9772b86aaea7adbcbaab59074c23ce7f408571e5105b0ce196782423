"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareTurn = prepareTurn;
const errors_1 = require("../errors.js");
const logger_1 = __importDefault(require("../logger.js"));
const guardrails_1 = require("./guardrails.js");
const items_1 = require("./items.js");
const modelPreparation_1 = require("./modelPreparation.js");
async function prepareTurn(options) {
    const { state, input, generatedItems, isResumedState, preserveTurnPersistenceOnResume, continuingInterruptedTurn, serverConversationTracker, inputGuardrailDefs, guardrailHandlers, emitAgentStart, } = options;
    const artifacts = await (0, modelPreparation_1.prepareAgentArtifacts)(state);
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
        throw new errors_1.MaxTurnsExceededError(`Max turns (${state._maxTurns}) exceeded`, state);
    }
    logger_1.default.debug(`Running agent ${state._currentAgent.name} (turn ${state._currentTurn})`);
    const { parallelGuardrailPromise } = await runInputGuardrailsForTurn(state, inputGuardrailDefs, isResumingFromInterruption, guardrailHandlers);
    const turnInput = serverConversationTracker
        ? serverConversationTracker.prepareInput(input, generatedItems)
        : (0, items_1.getTurnInput)(input, generatedItems);
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
    const guardrailDefs = (0, guardrails_1.buildInputGuardrailDefinitions)(state, runnerGuardrails);
    const guardrails = (0, guardrails_1.splitInputGuardrails)(guardrailDefs);
    if (guardrails.blocking.length > 0) {
        await (0, guardrails_1.runInputGuardrails)(state, guardrails.blocking);
    }
    if (guardrails.parallel.length > 0) {
        handlers.onParallelStart?.();
        const promise = (0, guardrails_1.runInputGuardrails)(state, guardrails.parallel);
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
//# sourceMappingURL=turnPreparation.js.map