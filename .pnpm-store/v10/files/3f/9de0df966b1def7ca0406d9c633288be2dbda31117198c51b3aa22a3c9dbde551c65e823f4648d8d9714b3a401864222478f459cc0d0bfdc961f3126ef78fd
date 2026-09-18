import { Agent, AgentOutputType } from '../agent';
import { RunItem } from '../items';
import { ModelResponse } from '../model';
import { RunContext } from '../runContext';
import { AgentInputItem } from '../types';
export { getTurnInput } from './items';
export type ModelInputData = {
    input: AgentInputItem[];
    instructions?: string;
};
export type CallModelInputFilterArgs<TContext = unknown> = {
    modelData: ModelInputData;
    agent: Agent<TContext, AgentOutputType>;
    context: TContext | undefined;
};
export type CallModelInputFilter<TContext = unknown> = (args: CallModelInputFilterArgs<TContext>) => ModelInputData | Promise<ModelInputData>;
/**
 * Result of applying a `callModelInputFilter`.
 * - `modelInput` is the payload that goes to the model.
 * - `sourceItems` maps each filtered item back to the original turn item (or `undefined` when none).
 *   This lets the conversation tracker know which originals reached the model.
 * - `persistedItems` are the filtered clones we should commit to session memory so the stored
 *   history reflects any redactions or truncation introduced by the filter.
 * - `filterApplied` signals whether a filter ran so callers can distinguish empty filtered results
 *   from the filter being skipped entirely.
 */
export type FilterApplicationResult = {
    modelInput: {
        input: AgentInputItem[];
        instructions?: string;
    };
    sourceItems: (AgentInputItem | undefined)[];
    persistedItems: AgentInputItem[];
    filterApplied: boolean;
};
/**
 * Applies the optional callModelInputFilter and returns the filtered input alongside the original
 * items so downstream tracking and session persistence stay in sync with what the model saw.
 */
export declare function applyCallModelInputFilter<TContext>(agent: Agent<TContext, AgentOutputType>, callModelInputFilter: CallModelInputFilter<any> | undefined, context: RunContext<TContext>, inputItems: AgentInputItem[], systemInstructions: string | undefined): Promise<FilterApplicationResult>;
/**
 * Tracks which items have already been sent to or received from the Responses API when the caller
 * supplies `conversationId`/`previousResponseId`. This ensures we only send the delta each turn.
 */
export declare class ServerConversationTracker {
    conversationId?: string;
    previousResponseId?: string;
    private sentInitialInput;
    private sentItems;
    private serverItems;
    private remainingInitialInput;
    constructor({ conversationId, previousResponseId, }: {
        conversationId?: string;
        previousResponseId?: string;
    });
    /**
     * Pre-populates tracker caches from an existing RunState when resuming server-managed runs.
     */
    primeFromState({ originalInput, generatedItems, modelResponses, }: {
        originalInput: string | AgentInputItem[];
        generatedItems: RunItem[];
        modelResponses: ModelResponse[];
    }): void;
    /**
     * Records the raw items returned by the server so future delta calculations skip them.
     * Also captures the latest response identifier to chain follow-up calls when possible.
     */
    trackServerItems(modelResponse: ModelResponse | undefined): void;
    /**
     * Returns the minimum set of items that still need to be delivered to the server for the
     * current turn. This includes the original turn inputs (until acknowledged) plus any
     * newly generated items that have not yet been echoed back by the API.
     */
    prepareInput(originalInput: string | AgentInputItem[], generatedItems: RunItem[]): AgentInputItem[];
    /**
     * Marks the provided originals as delivered so future turns do not resend them and any
     * pending initial inputs can be dropped once the server acknowledges receipt.
     */
    markInputAsSent(items: (AgentInputItem | undefined)[], options?: {
        filterApplied?: boolean;
        allTurnItems?: AgentInputItem[];
    }): void;
    private addDeliveredItems;
    private updateRemainingInitialInput;
}
