import type { AgentInputItem } from '../types';
import type { RequestUsage } from '../usage';
/**
 * A function that combines session history with new input items before the model call.
 */
export type SessionInputCallback = (historyItems: AgentInputItem[], newItems: AgentInputItem[]) => AgentInputItem[] | Promise<AgentInputItem[]>;
/**
 * Interface representing a persistent session store for conversation history.
 */
export interface Session {
    /**
     * Ensure and return the identifier for this session.
     */
    getSessionId(): Promise<string>;
    /**
     * Retrieve items from the conversation history.
     *
     * @param limit - The maximum number of items to return. When provided the most
     * recent {@link limit} items should be returned in chronological order.
     */
    getItems(limit?: number): Promise<AgentInputItem[]>;
    /**
     * Append new items to the conversation history.
     *
     * @param items - Items to add to the session history.
     */
    addItems(items: AgentInputItem[]): Promise<void>;
    /**
     * Remove and return the most recent item from the conversation history if it
     * exists.
     */
    popItem(): Promise<AgentInputItem | undefined>;
    /**
     * Remove all items that belong to the session and reset its state.
     */
    clearSession(): Promise<void>;
}
/**
 * Session subtype that can run compaction logic after a completed turn is persisted.
 */
export type OpenAIResponsesCompactionArgs = {
    /**
     * The `response.id` from a completed OpenAI Responses API turn, if available.
     *
     * When omitted, implementations may fall back to a cached value or throw.
     */
    responseId?: string | undefined;
    /**
     * When true, compaction should run regardless of any internal thresholds or hooks.
     */
    force?: boolean;
};
export type OpenAIResponsesCompactionResult = {
    usage: RequestUsage;
};
export interface OpenAIResponsesCompactionAwareSession extends Session {
    /**
     * Invoked by the runner after it persists a completed turn into the session.
     *
     * Implementations may decide to call `responses.compact` (or an equivalent API) and replace the
     * stored history.
     *
     * This hook is best-effort. Implementations should consider handling transient failures and
     * deciding whether to retry or skip compaction for the current turn.
     */
    runCompaction(args?: OpenAIResponsesCompactionArgs): Promise<OpenAIResponsesCompactionResult | null> | OpenAIResponsesCompactionResult | null;
}
export declare function isOpenAIResponsesCompactionAwareSession(session: Session | undefined): session is OpenAIResponsesCompactionAwareSession;
