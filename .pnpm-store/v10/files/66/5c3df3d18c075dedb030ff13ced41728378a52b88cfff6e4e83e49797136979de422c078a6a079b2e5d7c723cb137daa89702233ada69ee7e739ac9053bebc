"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGuardrailTracker = void 0;
exports.buildInputGuardrailDefinitions = buildInputGuardrailDefinitions;
exports.splitInputGuardrails = splitInputGuardrails;
exports.runInputGuardrails = runInputGuardrails;
exports.runOutputGuardrails = runOutputGuardrails;
const errors_1 = require("../errors.js");
const guardrail_1 = require("../guardrail.js");
const items_1 = require("./items.js");
const tracing_1 = require("../tracing/index.js");
const createGuardrailTracker = () => {
    let pending = false;
    let failed = false;
    let error = undefined;
    let promise;
    const setError = (err) => {
        failed = true;
        error = err;
        pending = false;
    };
    const setPromise = (incoming) => {
        if (!incoming) {
            return;
        }
        pending = true;
        promise = incoming
            .then((results) => results)
            .catch((err) => {
            setError(err);
            // Swallow to keep downstream flow consistent; failure is signaled via `failed`.
            return [];
        })
            .finally(() => {
            pending = false;
        });
    };
    const throwIfError = () => {
        if (error) {
            throw error;
        }
    };
    const awaitCompletion = async (options) => {
        if (promise) {
            await promise;
        }
        if (error && !options?.suppressErrors) {
            throw error;
        }
    };
    return {
        get pending() {
            return pending;
        },
        get failed() {
            return failed;
        },
        get error() {
            return error;
        },
        markPending: () => {
            pending = true;
        },
        setPromise,
        setError,
        throwIfError,
        awaitCompletion,
    };
};
exports.createGuardrailTracker = createGuardrailTracker;
async function runGuardrailsWithTripwire(options) {
    const { state, guardrails, guardrailArgs, resultsTarget, onTripwire, isTripwireError, onError, } = options;
    try {
        const results = await Promise.all(guardrails.map(async (guardrail) => {
            return (0, tracing_1.withGuardrailSpan)(async (span) => {
                const result = await guardrail.run(guardrailArgs);
                span.spanData.triggered = result.output.tripwireTriggered;
                return result;
            }, { data: { name: guardrail.name } }, state._currentAgentSpan);
        }));
        resultsTarget.push(...results);
        for (const result of results) {
            if (result.output.tripwireTriggered) {
                if (state._currentAgentSpan) {
                    state._currentAgentSpan.setError({
                        message: 'Guardrail tripwire triggered',
                        data: { guardrail: result.guardrail.name },
                    });
                }
                onTripwire(result);
            }
        }
        return results;
    }
    catch (error) {
        if (isTripwireError(error)) {
            throw error;
        }
        onError(error);
        return [];
    }
}
function buildInputGuardrailDefinitions(state, runnerGuardrails) {
    return runnerGuardrails.concat(state._currentAgent.inputGuardrails.map(guardrail_1.defineInputGuardrail));
}
function splitInputGuardrails(guardrails) {
    const blocking = [];
    const parallel = [];
    for (const guardrail of guardrails) {
        if (guardrail.runInParallel === false) {
            blocking.push(guardrail);
        }
        else {
            parallel.push(guardrail);
        }
    }
    return { blocking, parallel };
}
async function runInputGuardrails(state, guardrails) {
    if (guardrails.length === 0) {
        return [];
    }
    const guardrailArgs = {
        agent: state._currentAgent,
        input: state._originalInput,
        context: state._context,
    };
    return await runGuardrailsWithTripwire({
        state,
        guardrails,
        guardrailArgs,
        resultsTarget: state._inputGuardrailResults,
        onTripwire: (result) => {
            throw new errors_1.InputGuardrailTripwireTriggered(`Input guardrail triggered: ${JSON.stringify(result.output.outputInfo)}`, result, state);
        },
        isTripwireError: (error) => error instanceof errors_1.InputGuardrailTripwireTriggered,
        onError: (error) => {
            // roll back the current turn to enable reruns
            state._currentTurn--;
            throw new errors_1.GuardrailExecutionError(`Input guardrail failed to complete: ${error}`, error, state);
        },
    });
}
async function runOutputGuardrails(state, runnerOutputGuardrails, output) {
    const guardrails = runnerOutputGuardrails.concat(state._currentAgent.outputGuardrails.map(guardrail_1.defineOutputGuardrail));
    if (guardrails.length === 0) {
        return;
    }
    const agentOutput = state._currentAgent.processFinalOutput(output);
    const runOutput = (0, items_1.getTurnInput)([], state._generatedItems);
    const guardrailArgs = {
        agent: state._currentAgent,
        agentOutput,
        context: state._context,
        details: {
            modelResponse: state._lastTurnResponse,
            output: runOutput,
        },
    };
    await runGuardrailsWithTripwire({
        state,
        guardrails,
        guardrailArgs,
        resultsTarget: state._outputGuardrailResults,
        onTripwire: (result) => {
            throw new errors_1.OutputGuardrailTripwireTriggered(`Output guardrail triggered: ${JSON.stringify(result.output.outputInfo)}`, result, state);
        },
        isTripwireError: (error) => error instanceof errors_1.OutputGuardrailTripwireTriggered,
        onError: (error) => {
            throw new errors_1.GuardrailExecutionError(`Output guardrail failed to complete: ${error}`, error, state);
        },
    });
}
//# sourceMappingURL=guardrails.js.map