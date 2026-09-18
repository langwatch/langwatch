import OpenAI from 'openai';
import type { AgentInputItem, OpenAIResponsesCompactionArgs, OpenAIResponsesCompactionAwareSession as OpenAIResponsesCompactionSessionLike, Session } from '@openai/agents-core';
import type { OpenAIResponsesCompactionResult } from '@openai/agents-core';
import { OPENAI_SESSION_API, type OpenAISessionApiTagged } from './openaiSessionApi';
export type OpenAIResponsesCompactionDecisionContext = {
    /**
     * The `response.id` from a completed OpenAI Responses API turn, if available.
     */
    responseId: string | undefined;
    /**
     * Items considered compaction candidates (excludes user and compaction items).
     * The array must not be mutated.
     */
    compactionCandidateItems: AgentInputItem[];
    /**
     * All stored items retrieved from the underlying session, if available.
     * The array must not be mutated.
     */
    sessionItems: AgentInputItem[];
};
export type OpenAIResponsesCompactionSessionOptions = {
    /**
     * OpenAI client used to call `responses.compact`.
     *
     * When omitted, the session will use `getDefaultOpenAIClient()` if configured. Otherwise it
     * creates a new `OpenAI()` instance via `new OpenAI()`.
     */
    client?: OpenAI;
    /**
     * Session store that receives items and holds the compacted history.
     *
     * The underlying session is the source of truth for persisted items. Compaction clears the
     * underlying session and writes the output items returned by `responses.compact`.
     *
     * This must not be an `OpenAIConversationsSession`, because compaction relies on the Responses
     * API `previous_response_id` flow.
     *
     * Defaults to an in-memory session for demos.
     */
    underlyingSession?: Session & {
        [OPENAI_SESSION_API]?: 'responses';
    };
    /**
     * The OpenAI model to use for `responses.compact`.
     *
     * Defaults to `DEFAULT_OPENAI_MODEL`. The value must resemble an OpenAI model name (for example
     * `gpt-*`, `o*`, or a fine-tuned `ft:gpt-*` identifier), otherwise the constructor throws.
     */
    model?: OpenAI.ResponsesModel;
    /**
     * Custom decision hook that determines whether to call `responses.compact`.
     *
     * The default implementation compares the length of
     * {@link OpenAIResponsesCompactionDecisionContext.compactionCandidateItems} to an internal threshold
     * (10). Override this to support token-based triggers or other heuristics using
     * {@link OpenAIResponsesCompactionDecisionContext.compactionCandidateItems} or
     * {@link OpenAIResponsesCompactionDecisionContext.sessionItems}.
     */
    shouldTriggerCompaction?: (context: OpenAIResponsesCompactionDecisionContext) => boolean | Promise<boolean>;
};
/**
 * Session decorator that triggers `responses.compact` when the stored history grows.
 *
 * This session is intended to be passed to `run()` so the runner can automatically supply the
 * latest `responseId` and invoke compaction after each completed turn is persisted.
 *
 * To debug compaction decisions, enable the `debug` logger for
 * `openai-agents:openai:compaction` (for example, `DEBUG=openai-agents:openai:compaction`).
 */
export declare class OpenAIResponsesCompactionSession implements OpenAIResponsesCompactionSessionLike, OpenAISessionApiTagged<'responses'> {
    readonly [OPENAI_SESSION_API]: "responses";
    private readonly client;
    private readonly underlyingSession;
    private readonly model;
    private responseId?;
    private readonly shouldTriggerCompaction;
    private compactionCandidateItems;
    private sessionItems;
    constructor(options: OpenAIResponsesCompactionSessionOptions);
    runCompaction(args?: OpenAIResponsesCompactionArgs): Promise<OpenAIResponsesCompactionResult | null>;
    getSessionId(): Promise<string>;
    getItems(limit?: number): Promise<AgentInputItem[]>;
    addItems(items: AgentInputItem[]): Promise<void>;
    popItem(): Promise<AgentInputItem | undefined>;
    clearSession(): Promise<void>;
    private ensureCompactionCandidates;
}
