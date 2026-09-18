import { Agent } from "./agent.mjs";
import { RunAgentUpdatedStreamEvent, RunRawModelStreamEvent } from "./events.mjs";
import { ModelBehaviorError, UserError } from "./errors.mjs";
import { defineInputGuardrail, defineOutputGuardrail, } from "./guardrail.mjs";
import { RunHooks } from "./lifecycle.mjs";
import logger from "./logger.mjs";
import { getDefaultModelProvider } from "./providers.mjs";
import { RunContext } from "./runContext.mjs";
import { RunResult, StreamedRunResult } from "./result.mjs";
import { RunState } from "./runState.mjs";
import { disposeResolvedComputers } from "./tool.mjs";
import { getOrCreateTrace, resetCurrentSpan, setCurrentSpan, withNewSpanContext, withTrace, } from "./tracing/context.mjs";
import { Usage } from "./usage.mjs";
import { convertAgentOutputTypeToSerializable } from "./utils/tools.mjs";
import { DEFAULT_MAX_TURNS } from "./runner/constants.mjs";
import { StreamEventResponseCompleted } from "./types/protocol.mjs";
import { ServerConversationTracker, applyCallModelInputFilter, } from "./runner/conversation.mjs";
import { createGuardrailTracker, runOutputGuardrails, } from "./runner/guardrails.mjs";
import { adjustModelSettingsForNonGPT5RunnerModel, maybeResetToolChoice, selectModel, } from "./runner/modelSettings.mjs";
import { processModelResponse } from "./runner/modelOutputs.mjs";
import { addStepToRunResult, streamStepItemsToRunResult, isAbortError, } from "./runner/streaming.mjs";
import { createSessionPersistenceTracker, prepareInputItemsWithSession, saveStreamInputToSession, saveStreamResultToSession, saveToSession, } from "./runner/sessionPersistence.mjs";
import { resolveTurnAfterModelResponse } from "./runner/turnResolution.mjs";
import { prepareTurn } from "./runner/turnPreparation.mjs";
import { applyTurnResult, handleInterruptedOutcome, resumeInterruptedTurn, } from "./runner/runLoop.mjs";
import { getTracing } from "./runner/tracing.mjs";
export { getTracing } from "./runner/tracing.mjs";
export { selectModel } from "./runner/modelSettings.mjs";
export { getTurnInput } from "./runner/items.mjs";
export async function run(agent, input, options) {
    const runner = getDefaultRunner();
    if (options?.stream) {
        return await runner.run(agent, input, options);
    }
    else {
        return await runner.run(agent, input, options);
    }
}
/**
 * Orchestrates agent execution, including guardrails, tool calls, session persistence, and
 * tracing. Reuse a `Runner` instance when you want consistent configuration across multiple runs.
 */
export class Runner extends RunHooks {
    config;
    /**
     * Creates a runner with optional defaults that apply to every subsequent run invocation.
     *
     * @param config - Overrides for models, guardrails, tracing, or session behavior.
     */
    constructor(config = {}) {
        super();
        this.config = {
            modelProvider: config.modelProvider ?? getDefaultModelProvider(),
            model: config.model,
            modelSettings: config.modelSettings,
            handoffInputFilter: config.handoffInputFilter,
            inputGuardrails: config.inputGuardrails,
            outputGuardrails: config.outputGuardrails,
            tracingDisabled: config.tracingDisabled ?? false,
            traceIncludeSensitiveData: config.traceIncludeSensitiveData ?? true,
            workflowName: config.workflowName ?? 'Agent workflow',
            traceId: config.traceId,
            groupId: config.groupId,
            traceMetadata: config.traceMetadata,
            tracing: config.tracing,
            sessionInputCallback: config.sessionInputCallback,
            callModelInputFilter: config.callModelInputFilter,
        };
        this.inputGuardrailDefs = (config.inputGuardrails ?? []).map(defineInputGuardrail);
        this.outputGuardrailDefs = (config.outputGuardrails ?? []).map(defineOutputGuardrail);
    }
    async run(agent, input, options = {
        stream: false,
        context: undefined,
    }) {
        const resolvedOptions = options ?? { stream: false, context: undefined };
        // Per-run options take precedence over runner defaults for session memory behavior.
        const sessionInputCallback = resolvedOptions.sessionInputCallback ?? this.config.sessionInputCallback;
        // Likewise allow callers to override callModelInputFilter on individual runs.
        const callModelInputFilter = resolvedOptions.callModelInputFilter ?? this.config.callModelInputFilter;
        const hasCallModelInputFilter = Boolean(callModelInputFilter);
        const tracingConfig = resolvedOptions.tracing ?? this.config.tracing;
        const effectiveOptions = {
            ...resolvedOptions,
            sessionInputCallback,
            callModelInputFilter,
        };
        const resumingFromState = input instanceof RunState;
        const preserveTurnPersistenceOnResume = resumingFromState &&
            input._currentTurnInProgress === true;
        const resumedConversationId = resumingFromState
            ? input._conversationId
            : undefined;
        const resumedPreviousResponseId = resumingFromState
            ? input._previousResponseId
            : undefined;
        const serverManagesConversation = Boolean(effectiveOptions.conversationId ?? resumedConversationId) ||
            Boolean(effectiveOptions.previousResponseId ?? resumedPreviousResponseId);
        // When the server tracks conversation history we defer to it for previous turns so local session
        // persistence can focus solely on the new delta being generated in this process.
        const session = effectiveOptions.session;
        const sessionPersistence = createSessionPersistenceTracker({
            session,
            hasCallModelInputFilter,
            persistInput: saveStreamInputToSession,
            resumingFromState,
        });
        let preparedInput = input;
        if (!(preparedInput instanceof RunState)) {
            const prepared = await prepareInputItemsWithSession(preparedInput, session, sessionInputCallback, {
                // When the server tracks conversation state we only send the new turn inputs;
                // previous messages are recovered via conversationId/previousResponseId.
                includeHistoryInPreparedInput: !serverManagesConversation,
                preserveDroppedNewItems: serverManagesConversation,
            });
            if (serverManagesConversation && session) {
                // When the server manages memory we only persist the new turn inputs locally so the
                // conversation service stays the single source of truth for prior exchanges.
                const sessionItems = prepared.sessionItems;
                if (sessionItems && sessionItems.length > 0) {
                    preparedInput = sessionItems;
                }
                else {
                    preparedInput = prepared.preparedInput;
                }
            }
            else {
                preparedInput = prepared.preparedInput;
            }
            sessionPersistence?.setPreparedItems(prepared.sessionItems);
        }
        // Streaming runs persist the input asynchronously, so track a one-shot helper
        // that can be awaited from multiple branches without double-writing.
        const ensureStreamInputPersisted = sessionPersistence?.buildPersistInputOnce(serverManagesConversation);
        const executeRun = async () => {
            if (effectiveOptions.stream) {
                const streamResult = await this.#runIndividualStream(agent, preparedInput, effectiveOptions, ensureStreamInputPersisted, sessionPersistence?.recordTurnItems, preserveTurnPersistenceOnResume);
                return streamResult;
            }
            const runResult = await this.#runIndividualNonStream(agent, preparedInput, effectiveOptions, sessionPersistence?.recordTurnItems, preserveTurnPersistenceOnResume);
            // See note above: allow sessions to run for callbacks/state but skip writes when the server
            // is the source of truth for transcript history.
            if (sessionPersistence && !serverManagesConversation) {
                await saveToSession(session, sessionPersistence.getItemsForPersistence(), runResult);
            }
            return runResult;
        };
        if (preparedInput instanceof RunState && preparedInput._trace) {
            return withTrace(preparedInput._trace, async () => {
                if (preparedInput._currentAgentSpan) {
                    setCurrentSpan(preparedInput._currentAgentSpan);
                }
                return executeRun();
            });
        }
        return getOrCreateTrace(async () => executeRun(), {
            traceId: this.config.traceId,
            name: this.config.workflowName,
            groupId: this.config.groupId,
            metadata: this.config.traceMetadata,
            // Per-run tracing config overrides exporter defaults such as environment API key.
            tracingApiKey: tracingConfig?.apiKey,
        });
    }
    // --------------------------------------------------------------
    //  Internals
    // --------------------------------------------------------------
    inputGuardrailDefs;
    outputGuardrailDefs;
    /**
     * @internal
     * Resolves the effective model once so both run loops obey the same precedence rules.
     */
    async #resolveModelForAgent(agent) {
        const explictlyModelSet = (agent.model !== undefined &&
            agent.model !== Agent.DEFAULT_MODEL_PLACEHOLDER) ||
            (this.config.model !== undefined &&
                this.config.model !== Agent.DEFAULT_MODEL_PLACEHOLDER);
        const selectedModel = selectModel(agent.model, this.config.model);
        const resolvedModelName = typeof selectedModel === 'string' ? selectedModel : undefined;
        const resolvedModel = typeof selectedModel === 'string'
            ? await this.config.modelProvider.getModel(selectedModel)
            : selectedModel;
        return { model: resolvedModel, explictlyModelSet, resolvedModelName };
    }
    /**
     * @internal
     */
    async #runIndividualNonStream(startingAgent, input, options, 
    // sessionInputUpdate lets the caller adjust queued session items after filters run so we
    // persist exactly what we send to the model (e.g., after redactions or truncation).
    sessionInputUpdate, preserveTurnPersistenceOnResume) {
        return withNewSpanContext(async () => {
            // if we have a saved state we use that one, otherwise we create a new one
            const isResumedState = input instanceof RunState;
            const state = isResumedState
                ? input
                : new RunState(options.context instanceof RunContext
                    ? options.context
                    : new RunContext(options.context), input, startingAgent, options.maxTurns ?? DEFAULT_MAX_TURNS);
            const resolvedConversationId = options.conversationId ??
                (isResumedState ? state._conversationId : undefined);
            const resolvedPreviousResponseId = options.previousResponseId ??
                (isResumedState ? state._previousResponseId : undefined);
            if (!isResumedState) {
                state.setConversationContext(resolvedConversationId, resolvedPreviousResponseId);
            }
            const serverConversationTracker = resolvedConversationId || resolvedPreviousResponseId
                ? new ServerConversationTracker({
                    conversationId: resolvedConversationId,
                    previousResponseId: resolvedPreviousResponseId,
                })
                : undefined;
            if (serverConversationTracker && isResumedState) {
                serverConversationTracker.primeFromState({
                    originalInput: state._originalInput,
                    generatedItems: state._generatedItems,
                    modelResponses: state._modelResponses,
                });
                state.setConversationContext(serverConversationTracker.conversationId, serverConversationTracker.previousResponseId);
            }
            // Tracks when we resume an approval interruption so the next run-again step stays in the same turn.
            let continuingInterruptedTurn = false;
            try {
                while (true) {
                    // if we don't have a current step, we treat this as a new run
                    state._currentStep = state._currentStep ?? {
                        type: 'next_step_run_again',
                    };
                    if (state._currentStep.type === 'next_step_interruption') {
                        logger.debug('Continuing from interruption');
                        if (!state._lastTurnResponse || !state._lastProcessedResponse) {
                            throw new UserError('No model response found in previous state', state);
                        }
                        const interruptedOutcome = await resumeInterruptedTurn({
                            state,
                            runner: this,
                        });
                        // Don't reset counter here - resolveInterruptedTurn already adjusted it via rewind logic
                        // The counter will be reset when _currentTurn is incremented (starting a new turn)
                        const { shouldReturn, shouldContinue } = handleInterruptedOutcome({
                            state,
                            outcome: interruptedOutcome,
                            setContinuingInterruptedTurn: (value) => {
                                continuingInterruptedTurn = value;
                            },
                        });
                        if (shouldReturn) {
                            // we are still in an interruption, so we need to avoid an infinite loop
                            return new RunResult(state);
                        }
                        if (shouldContinue) {
                            continue;
                        }
                    }
                    if (state._currentStep.type === 'next_step_run_again') {
                        const wasContinuingInterruptedTurn = continuingInterruptedTurn;
                        continuingInterruptedTurn = false;
                        const guardrailTracker = createGuardrailTracker();
                        const previousTurn = state._currentTurn;
                        const previousPersistedCount = state._currentTurnPersistedItemCount;
                        const previousGeneratedCount = state._generatedItems.length;
                        const { artifacts, turnInput, parallelGuardrailPromise } = await prepareTurn({
                            state,
                            input: state._originalInput,
                            generatedItems: state._generatedItems,
                            isResumedState,
                            preserveTurnPersistenceOnResume,
                            continuingInterruptedTurn: wasContinuingInterruptedTurn,
                            serverConversationTracker,
                            inputGuardrailDefs: this.inputGuardrailDefs,
                            guardrailHandlers: {
                                onParallelStart: guardrailTracker.markPending,
                                onParallelError: guardrailTracker.setError,
                            },
                            emitAgentStart: (context, agent, inputItems) => {
                                this.emit('agent_start', context, agent, inputItems);
                            },
                        });
                        if (preserveTurnPersistenceOnResume &&
                            state._currentTurn > previousTurn &&
                            previousPersistedCount <= previousGeneratedCount) {
                            // Preserve persisted offsets from a resumed run to avoid re-saving prior items.
                            state._currentTurnPersistedItemCount = previousPersistedCount;
                        }
                        guardrailTracker.setPromise(parallelGuardrailPromise);
                        const preparedCall = await this.#prepareModelCall(state, options, artifacts, turnInput, serverConversationTracker, sessionInputUpdate);
                        guardrailTracker.throwIfError();
                        state._lastTurnResponse = await preparedCall.model.getResponse({
                            systemInstructions: preparedCall.modelInput.instructions,
                            prompt: preparedCall.prompt,
                            // Explicit agent/run config models should take precedence over prompt defaults.
                            ...(preparedCall.explictlyModelSet
                                ? { overridePromptModel: true }
                                : {}),
                            input: preparedCall.modelInput.input,
                            previousResponseId: preparedCall.previousResponseId,
                            conversationId: preparedCall.conversationId,
                            modelSettings: preparedCall.modelSettings,
                            tools: preparedCall.serializedTools,
                            toolsExplicitlyProvided: preparedCall.toolsExplicitlyProvided,
                            outputType: convertAgentOutputTypeToSerializable(state._currentAgent.outputType),
                            handoffs: preparedCall.serializedHandoffs,
                            tracing: getTracing(this.config.tracingDisabled, this.config.traceIncludeSensitiveData),
                            signal: options.signal,
                        });
                        if (serverConversationTracker) {
                            serverConversationTracker.markInputAsSent(preparedCall.sourceItems, {
                                filterApplied: preparedCall.filterApplied,
                                allTurnItems: preparedCall.turnInput,
                            });
                        }
                        state._modelResponses.push(state._lastTurnResponse);
                        state._context.usage.add(state._lastTurnResponse.usage);
                        state._noActiveAgentRun = false;
                        // After each turn record the items echoed by the server so future requests only
                        // include the incremental inputs that have not yet been acknowledged.
                        serverConversationTracker?.trackServerItems(state._lastTurnResponse);
                        if (serverConversationTracker) {
                            state.setConversationContext(serverConversationTracker.conversationId, serverConversationTracker.previousResponseId);
                        }
                        const processedResponse = processModelResponse(state._lastTurnResponse, state._currentAgent, preparedCall.tools, preparedCall.handoffs);
                        state._lastProcessedResponse = processedResponse;
                        const turnResult = await resolveTurnAfterModelResponse(state._currentAgent, state._originalInput, state._generatedItems, state._lastTurnResponse, state._lastProcessedResponse, this, state);
                        applyTurnResult({
                            state,
                            turnResult,
                            agent: state._currentAgent,
                            toolsUsed: state._lastProcessedResponse?.toolsUsed ?? [],
                            resetTurnPersistence: !isResumedState,
                        });
                        await guardrailTracker.awaitCompletion();
                    }
                    const currentStep = state._currentStep;
                    if (!currentStep) {
                        logger.debug('Running next loop');
                        continue;
                    }
                    switch (currentStep.type) {
                        case 'next_step_final_output':
                            await runOutputGuardrails(state, this.outputGuardrailDefs, currentStep.output);
                            state._currentTurnInProgress = false;
                            this.emit('agent_end', state._context, state._currentAgent, currentStep.output);
                            state._currentAgent.emit('agent_end', state._context, currentStep.output);
                            return new RunResult(state);
                        case 'next_step_handoff':
                            state.setCurrentAgent(currentStep.newAgent);
                            if (state._currentAgentSpan) {
                                state._currentAgentSpan.end();
                                resetCurrentSpan();
                                state.setCurrentAgentSpan(undefined);
                            }
                            state._noActiveAgentRun = true;
                            state._currentTurnInProgress = false;
                            // We've processed the handoff, so we need to run the loop again.
                            state._currentStep = { type: 'next_step_run_again' };
                            break;
                        case 'next_step_interruption':
                            // Interrupted. Don't run any guardrails.
                            return new RunResult(state);
                        case 'next_step_run_again':
                            state._currentTurnInProgress = false;
                            logger.debug('Running next loop');
                            break;
                        default:
                            logger.debug('Running next loop');
                    }
                }
            }
            catch (err) {
                state._currentTurnInProgress = false;
                if (state._currentAgentSpan) {
                    state._currentAgentSpan.setError({
                        message: 'Error in agent run',
                        data: { error: String(err) },
                    });
                }
                throw err;
            }
            finally {
                if (state._currentStep?.type !== 'next_step_interruption') {
                    try {
                        await disposeResolvedComputers({ runContext: state._context });
                    }
                    catch (error) {
                        logger.warn(`Failed to dispose computers after run: ${error}`);
                    }
                }
                if (state._currentAgentSpan) {
                    if (state._currentStep?.type !== 'next_step_interruption') {
                        // don't end the span if the run was interrupted
                        state._currentAgentSpan.end();
                    }
                    resetCurrentSpan();
                }
            }
        });
    }
    /**
     * @internal
     */
    async #runStreamLoop(result, options, isResumedState, ensureStreamInputPersisted, sessionInputUpdate, preserveTurnPersistenceOnResume) {
        const resolvedConversationId = options.conversationId ?? result.state._conversationId;
        const resolvedPreviousResponseId = options.previousResponseId ?? result.state._previousResponseId;
        const serverManagesConversation = Boolean(resolvedConversationId) || Boolean(resolvedPreviousResponseId);
        const serverConversationTracker = serverManagesConversation
            ? new ServerConversationTracker({
                conversationId: resolvedConversationId,
                previousResponseId: resolvedPreviousResponseId,
            })
            : undefined;
        if (serverConversationTracker) {
            result.state.setConversationContext(serverConversationTracker.conversationId, serverConversationTracker.previousResponseId);
        }
        let sentInputToModel = false;
        let streamInputPersisted = false;
        let guardrailTracker = createGuardrailTracker();
        const persistStreamInputIfNeeded = async () => {
            if (streamInputPersisted || !ensureStreamInputPersisted) {
                return;
            }
            // Both success and error paths call this helper, so guard against multiple writes.
            await ensureStreamInputPersisted();
            streamInputPersisted = true;
        };
        let parallelGuardrailPromise;
        const awaitGuardrailsAndPersistInput = async () => {
            await guardrailTracker.awaitCompletion();
            if (guardrailTracker.failed) {
                throw guardrailTracker.error;
            }
            if (sentInputToModel &&
                !streamInputPersisted &&
                !guardrailTracker.failed) {
                await persistStreamInputIfNeeded();
            }
        };
        if (serverConversationTracker && isResumedState) {
            serverConversationTracker.primeFromState({
                originalInput: result.state._originalInput,
                generatedItems: result.state._generatedItems,
                modelResponses: result.state._modelResponses,
            });
            result.state.setConversationContext(serverConversationTracker.conversationId, serverConversationTracker.previousResponseId);
        }
        // Tracks when we resume an approval interruption so the next run-again step stays in the same turn.
        let continuingInterruptedTurn = false;
        try {
            while (true) {
                const currentAgent = result.state._currentAgent;
                result.state._currentStep = result.state._currentStep ?? {
                    type: 'next_step_run_again',
                };
                if (result.state._currentStep.type === 'next_step_interruption') {
                    logger.debug('Continuing from interruption');
                    if (!result.state._lastTurnResponse ||
                        !result.state._lastProcessedResponse) {
                        throw new UserError('No model response found in previous state', result.state);
                    }
                    const interruptedOutcome = await resumeInterruptedTurn({
                        state: result.state,
                        runner: this,
                        onStepItems: (turnResult) => {
                            addStepToRunResult(result, turnResult);
                        },
                    });
                    // Don't reset counter here - resolveInterruptedTurn already adjusted it via rewind logic
                    // The counter will be reset when _currentTurn is incremented (starting a new turn)
                    const { shouldReturn, shouldContinue } = handleInterruptedOutcome({
                        state: result.state,
                        outcome: interruptedOutcome,
                        setContinuingInterruptedTurn: (value) => {
                            continuingInterruptedTurn = value;
                        },
                    });
                    if (shouldReturn) {
                        // we are still in an interruption, so we need to avoid an infinite loop
                        return;
                    }
                    if (shouldContinue) {
                        continue;
                    }
                }
                if (result.state._currentStep.type === 'next_step_run_again') {
                    parallelGuardrailPromise = undefined;
                    guardrailTracker = createGuardrailTracker();
                    const wasContinuingInterruptedTurn = continuingInterruptedTurn;
                    continuingInterruptedTurn = false;
                    const previousTurn = result.state._currentTurn;
                    const previousPersistedCount = result.state._currentTurnPersistedItemCount;
                    const previousGeneratedCount = result.state._generatedItems.length;
                    const preparedTurn = await prepareTurn({
                        state: result.state,
                        input: result.input,
                        generatedItems: result.newItems,
                        isResumedState,
                        preserveTurnPersistenceOnResume,
                        continuingInterruptedTurn: wasContinuingInterruptedTurn,
                        serverConversationTracker,
                        inputGuardrailDefs: this.inputGuardrailDefs,
                        guardrailHandlers: {
                            onParallelStart: () => {
                                guardrailTracker.markPending();
                            },
                            onParallelError: (err) => {
                                guardrailTracker.setError(err);
                            },
                        },
                        emitAgentStart: (context, agent, inputItems) => {
                            this.emit('agent_start', context, agent, inputItems);
                        },
                    });
                    if (preserveTurnPersistenceOnResume &&
                        result.state._currentTurn > previousTurn &&
                        previousPersistedCount <= previousGeneratedCount) {
                        // Preserve persisted offsets from a resumed run to avoid re-saving prior items.
                        result.state._currentTurnPersistedItemCount =
                            previousPersistedCount;
                    }
                    const { artifacts, turnInput } = preparedTurn;
                    parallelGuardrailPromise = preparedTurn.parallelGuardrailPromise;
                    guardrailTracker.setPromise(parallelGuardrailPromise);
                    // If guardrails are still running, defer input persistence until they finish.
                    const delayStreamInputPersistence = guardrailTracker.pending;
                    const preparedCall = await this.#prepareModelCall(result.state, options, artifacts, turnInput, serverConversationTracker, sessionInputUpdate);
                    guardrailTracker.throwIfError();
                    let finalResponse = undefined;
                    let inputMarked = false;
                    const markInputOnce = () => {
                        if (inputMarked || !serverConversationTracker) {
                            return;
                        }
                        // We only mark inputs as sent after receiving the first stream event,
                        // which is the earliest reliable confirmation that the server accepted
                        // the request. If the stream fails before any events, leave inputs
                        // unmarked so a retry can resend safely.
                        // Record the exact input that was sent so the server tracker can advance safely.
                        serverConversationTracker.markInputAsSent(preparedCall.sourceItems, {
                            filterApplied: preparedCall.filterApplied,
                            allTurnItems: preparedCall.turnInput,
                        });
                        inputMarked = true;
                    };
                    sentInputToModel = true;
                    if (!delayStreamInputPersistence) {
                        await persistStreamInputIfNeeded();
                    }
                    try {
                        for await (const event of preparedCall.model.getStreamedResponse({
                            systemInstructions: preparedCall.modelInput.instructions,
                            prompt: preparedCall.prompt,
                            // Streaming requests should also honor explicitly chosen models.
                            ...(preparedCall.explictlyModelSet
                                ? { overridePromptModel: true }
                                : {}),
                            input: preparedCall.modelInput.input,
                            previousResponseId: preparedCall.previousResponseId,
                            conversationId: preparedCall.conversationId,
                            modelSettings: preparedCall.modelSettings,
                            tools: preparedCall.serializedTools,
                            toolsExplicitlyProvided: preparedCall.toolsExplicitlyProvided,
                            handoffs: preparedCall.serializedHandoffs,
                            outputType: convertAgentOutputTypeToSerializable(currentAgent.outputType),
                            tracing: getTracing(this.config.tracingDisabled, this.config.traceIncludeSensitiveData),
                            signal: options.signal,
                        })) {
                            guardrailTracker.throwIfError();
                            markInputOnce();
                            if (event.type === 'response_done') {
                                const parsed = StreamEventResponseCompleted.parse(event);
                                finalResponse = {
                                    usage: new Usage(parsed.response.usage),
                                    output: parsed.response.output,
                                    responseId: parsed.response.id,
                                };
                                result.state._context.usage.add(finalResponse.usage);
                            }
                            if (result.cancelled) {
                                // When the user's code exits a loop to consume the stream, we need to break
                                // this loop to prevent internal false errors and unnecessary processing
                                await awaitGuardrailsAndPersistInput();
                                return;
                            }
                            result._addItem(new RunRawModelStreamEvent(event));
                        }
                    }
                    catch (error) {
                        if (isAbortError(error)) {
                            if (sentInputToModel) {
                                markInputOnce();
                            }
                            await awaitGuardrailsAndPersistInput();
                            return;
                        }
                        throw error;
                    }
                    if (finalResponse) {
                        markInputOnce();
                    }
                    await awaitGuardrailsAndPersistInput();
                    if (result.cancelled) {
                        return;
                    }
                    result.state._noActiveAgentRun = false;
                    if (!finalResponse) {
                        throw new ModelBehaviorError('Model did not produce a final response!', result.state);
                    }
                    result.state._lastTurnResponse = finalResponse;
                    // Keep the tracker in sync with the streamed response so reconnections remain accurate.
                    serverConversationTracker?.trackServerItems(finalResponse);
                    if (serverConversationTracker) {
                        result.state.setConversationContext(serverConversationTracker.conversationId, serverConversationTracker.previousResponseId);
                    }
                    result.state._modelResponses.push(result.state._lastTurnResponse);
                    const processedResponse = processModelResponse(result.state._lastTurnResponse, currentAgent, preparedCall.tools, preparedCall.handoffs);
                    result.state._lastProcessedResponse = processedResponse;
                    // Record the items emitted directly from the model response so we do not
                    // stream them again after tools and other side effects finish.
                    const preToolItems = new Set(processedResponse.newItems);
                    if (preToolItems.size > 0) {
                        streamStepItemsToRunResult(result, processedResponse.newItems);
                    }
                    const turnResult = await resolveTurnAfterModelResponse(currentAgent, result.state._originalInput, result.state._generatedItems, result.state._lastTurnResponse, result.state._lastProcessedResponse, this, result.state);
                    applyTurnResult({
                        state: result.state,
                        turnResult,
                        agent: currentAgent,
                        toolsUsed: processedResponse.toolsUsed,
                        resetTurnPersistence: !isResumedState,
                        onStepItems: (step) => {
                            addStepToRunResult(result, step, { skipItems: preToolItems });
                        },
                    });
                }
                const currentStep = result.state._currentStep;
                switch (currentStep.type) {
                    case 'next_step_final_output':
                        await runOutputGuardrails(result.state, this.outputGuardrailDefs, currentStep.output);
                        result.state._currentTurnInProgress = false;
                        await persistStreamInputIfNeeded();
                        // Guardrails must succeed before persisting session memory to avoid storing blocked outputs.
                        if (!serverManagesConversation) {
                            await saveStreamResultToSession(options.session, result);
                        }
                        this.emit('agent_end', result.state._context, currentAgent, currentStep.output);
                        currentAgent.emit('agent_end', result.state._context, currentStep.output);
                        return;
                    case 'next_step_interruption':
                        // We are done for now. Don't run any output guardrails.
                        await persistStreamInputIfNeeded();
                        if (!serverManagesConversation) {
                            await saveStreamResultToSession(options.session, result);
                        }
                        return;
                    case 'next_step_handoff':
                        result.state.setCurrentAgent(currentStep.newAgent);
                        if (result.state._currentAgentSpan) {
                            result.state._currentAgentSpan.end();
                            resetCurrentSpan();
                        }
                        result.state.setCurrentAgentSpan(undefined);
                        result._addItem(new RunAgentUpdatedStreamEvent(result.state._currentAgent));
                        result.state._noActiveAgentRun = true;
                        result.state._currentTurnInProgress = false;
                        // We've processed the handoff, so we need to run the loop again.
                        result.state._currentStep = {
                            type: 'next_step_run_again',
                        };
                        break;
                    case 'next_step_run_again':
                        result.state._currentTurnInProgress = false;
                        logger.debug('Running next loop');
                        break;
                    default:
                        logger.debug('Running next loop');
                }
            }
        }
        catch (error) {
            result.state._currentTurnInProgress = false;
            if (guardrailTracker.pending) {
                await guardrailTracker.awaitCompletion({ suppressErrors: true });
            }
            if (sentInputToModel &&
                !streamInputPersisted &&
                !guardrailTracker.failed) {
                await persistStreamInputIfNeeded();
            }
            if (result.state._currentAgentSpan) {
                result.state._currentAgentSpan.setError({
                    message: 'Error in agent run',
                    data: { error: String(error) },
                });
            }
            throw error;
        }
        finally {
            if (guardrailTracker.pending) {
                await guardrailTracker.awaitCompletion({ suppressErrors: true });
            }
            if (sentInputToModel &&
                !streamInputPersisted &&
                !guardrailTracker.failed) {
                await persistStreamInputIfNeeded();
            }
            if (result.state._currentStep?.type !== 'next_step_interruption') {
                try {
                    await disposeResolvedComputers({ runContext: result.state._context });
                }
                catch (error) {
                    logger.warn(`Failed to dispose computers after run: ${error}`);
                }
            }
            if (result.state._currentAgentSpan) {
                if (result.state._currentStep?.type !== 'next_step_interruption') {
                    result.state._currentAgentSpan.end();
                }
                resetCurrentSpan();
            }
        }
    }
    /**
     * @internal
     */
    async #runIndividualStream(agent, input, options, ensureStreamInputPersisted, sessionInputUpdate, preserveTurnPersistenceOnResume) {
        options = options ?? {};
        return withNewSpanContext(async () => {
            // Initialize or reuse existing state
            const isResumedState = input instanceof RunState;
            const state = isResumedState
                ? input
                : new RunState(options.context instanceof RunContext
                    ? options.context
                    : new RunContext(options.context), input, agent, options.maxTurns ?? DEFAULT_MAX_TURNS);
            const resolvedConversationId = options.conversationId ??
                (isResumedState ? state._conversationId : undefined);
            const resolvedPreviousResponseId = options.previousResponseId ??
                (isResumedState ? state._previousResponseId : undefined);
            if (!isResumedState) {
                state.setConversationContext(resolvedConversationId, resolvedPreviousResponseId);
            }
            // Initialize the streamed result with existing state
            const result = new StreamedRunResult({
                signal: options.signal,
                state,
            });
            const streamOptions = {
                ...options,
                signal: result._getAbortSignal(),
            };
            // Setup defaults
            result.maxTurns = streamOptions.maxTurns ?? state._maxTurns;
            // Continue the stream loop without blocking
            const streamLoopPromise = this.#runStreamLoop(result, streamOptions, isResumedState, ensureStreamInputPersisted, sessionInputUpdate, preserveTurnPersistenceOnResume).then(() => {
                result._done();
            }, (err) => {
                result._raiseError(err);
            });
            // Attach the stream loop promise so trace end waits for the loop to complete
            result._setStreamLoopPromise(streamLoopPromise);
            return result;
        });
    }
    /**
     * @internal
     * Applies call-level filters and merges session updates so the model request mirrors exactly
     * what we persisted for history.
     */
    async #prepareModelCall(state, options, artifacts, turnInput, serverConversationTracker, sessionInputUpdate) {
        const { model, explictlyModelSet, resolvedModelName } = await this.#resolveModelForAgent(state._currentAgent);
        let modelSettings = {
            ...this.config.modelSettings,
            ...state._currentAgent.modelSettings,
        };
        modelSettings = adjustModelSettingsForNonGPT5RunnerModel(explictlyModelSet, state._currentAgent.modelSettings, model, modelSettings, resolvedModelName);
        modelSettings = maybeResetToolChoice(state._currentAgent, state._toolUseTracker, modelSettings);
        const systemInstructions = await state._currentAgent.getSystemPrompt(state._context);
        const prompt = await state._currentAgent.getPrompt(state._context);
        const { modelInput, sourceItems, persistedItems, filterApplied } = await applyCallModelInputFilter(state._currentAgent, options.callModelInputFilter, state._context, turnInput, systemInstructions);
        // Provide filtered clones whenever filters run so session history mirrors the model payload.
        // Returning an empty array is intentional: it tells the session layer to persist "nothing"
        // instead of falling back to the unfiltered originals when the filter redacts everything.
        sessionInputUpdate?.(sourceItems, filterApplied ? persistedItems : undefined);
        const previousResponseId = serverConversationTracker?.previousResponseId ??
            options.previousResponseId;
        const conversationId = serverConversationTracker?.conversationId ?? options.conversationId;
        return {
            ...artifacts,
            model,
            explictlyModelSet,
            modelSettings,
            modelInput,
            prompt,
            previousResponseId,
            conversationId,
            sourceItems,
            filterApplied,
            turnInput,
        };
    }
}
// internal helpers and constants
let defaultRunner;
const getDefaultRunner = () => {
    if (!defaultRunner) {
        defaultRunner = new Runner();
    }
    return defaultRunner;
};
//# sourceMappingURL=run.mjs.map