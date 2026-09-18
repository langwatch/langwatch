"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerConversationTracker = exports.getTurnInput = void 0;
exports.applyCallModelInputFilter = applyCallModelInputFilter;
const errors_1 = require("../errors.js");
const context_1 = require("../tracing/context.js");
const items_1 = require("./items.js");
var items_2 = require("./items.js");
Object.defineProperty(exports, "getTurnInput", { enumerable: true, get: function () { return items_2.getTurnInput; } });
/**
 * Applies the optional callModelInputFilter and returns the filtered input alongside the original
 * items so downstream tracking and session persistence stay in sync with what the model saw.
 */
async function applyCallModelInputFilter(agent, callModelInputFilter, context, inputItems, systemInstructions) {
    const cloneInputItems = (items, map) => items.map((item) => {
        const cloned = structuredClone(item);
        if (map && cloned && typeof cloned === 'object') {
            map.set(cloned, item);
        }
        return cloned;
    });
    // Record the relationship between the cloned array passed to filters and the original inputs.
    const cloneMap = new WeakMap();
    const originalPool = (0, items_1.buildAgentInputPool)(inputItems);
    const fallbackOriginals = [];
    // Track any original object inputs so filtered replacements can still mark them as delivered.
    for (const item of inputItems) {
        if (item && typeof item === 'object') {
            fallbackOriginals.push(item);
        }
    }
    const removeFromFallback = (candidate) => {
        if (!candidate || typeof candidate !== 'object') {
            return;
        }
        const index = fallbackOriginals.findIndex((original) => original === candidate);
        if (index !== -1) {
            fallbackOriginals.splice(index, 1);
        }
    };
    const takeFallbackOriginal = () => {
        const next = fallbackOriginals.shift();
        if (next) {
            (0, items_1.removeAgentInputFromPool)(originalPool, next);
        }
        return next;
    };
    // Always create a deep copy so downstream mutations inside filters cannot affect
    // the cached turn state.
    const clonedBaseInput = cloneInputItems(inputItems, cloneMap);
    const base = {
        input: clonedBaseInput,
        instructions: systemInstructions,
    };
    if (!callModelInputFilter) {
        return {
            modelInput: base,
            sourceItems: [...inputItems],
            persistedItems: [],
            filterApplied: false,
        };
    }
    try {
        const result = await callModelInputFilter({
            modelData: base,
            agent,
            context: context.context,
        });
        if (!result || !Array.isArray(result.input)) {
            throw new errors_1.UserError('callModelInputFilter must return a ModelInputData object with an input array.');
        }
        // Preserve a pointer to the original object backing each filtered clone so downstream
        // trackers can keep their bookkeeping consistent even after redaction.
        const sourceItems = result.input.map((item) => {
            if (!item || typeof item !== 'object') {
                return undefined;
            }
            const original = cloneMap.get(item);
            if (original) {
                removeFromFallback(original);
                (0, items_1.removeAgentInputFromPool)(originalPool, original);
                return original;
            }
            const key = (0, items_1.getAgentInputItemKey)(item);
            const matchedByContent = (0, items_1.takeAgentInputFromPool)(originalPool, key);
            if (matchedByContent) {
                removeFromFallback(matchedByContent);
                return matchedByContent;
            }
            const fallback = takeFallbackOriginal();
            if (fallback) {
                return fallback;
            }
            return undefined;
        });
        const clonedFilteredInput = cloneInputItems(result.input);
        return {
            modelInput: {
                input: clonedFilteredInput,
                instructions: typeof result.instructions === 'undefined'
                    ? systemInstructions
                    : result.instructions,
            },
            sourceItems,
            persistedItems: clonedFilteredInput.map((item) => structuredClone(item)),
            filterApplied: true,
        };
    }
    catch (error) {
        (0, context_1.addErrorToCurrentSpan)({
            message: 'Error in callModelInputFilter',
            data: { error: String(error) },
        });
        throw error;
    }
}
/**
 * Tracks which items have already been sent to or received from the Responses API when the caller
 * supplies `conversationId`/`previousResponseId`. This ensures we only send the delta each turn.
 */
class ServerConversationTracker {
    conversationId;
    previousResponseId;
    // Using this flag because WeakSet does not provide a way to check its size.
    sentInitialInput = false;
    // The items already sent to the model; using WeakSet for memory efficiency.
    sentItems = new WeakSet();
    // The items received from the server; using WeakSet for memory efficiency.
    serverItems = new WeakSet();
    // Track initial input items that have not yet been sent so they can be retried on later turns.
    remainingInitialInput = null;
    constructor({ conversationId, previousResponseId, }) {
        this.conversationId = conversationId ?? undefined;
        this.previousResponseId = previousResponseId ?? undefined;
    }
    /**
     * Pre-populates tracker caches from an existing RunState when resuming server-managed runs.
     */
    primeFromState({ originalInput, generatedItems, modelResponses, }) {
        if (this.sentInitialInput) {
            return;
        }
        const originalItems = (0, items_1.toAgentInputList)(originalInput);
        const hasResponses = modelResponses.length > 0;
        const serverItemKeys = new Set();
        for (const response of modelResponses) {
            for (const item of response.output) {
                if (item && typeof item === 'object') {
                    this.serverItems.add(item);
                    serverItemKeys.add((0, items_1.getAgentInputItemKey)(item));
                }
            }
        }
        if (hasResponses) {
            for (const item of originalItems) {
                if (item && typeof item === 'object') {
                    this.sentItems.add(item);
                }
            }
            this.sentInitialInput = true;
            this.remainingInitialInput = null;
        }
        const latestResponse = modelResponses[modelResponses.length - 1];
        if (!this.conversationId && latestResponse?.responseId) {
            this.previousResponseId = latestResponse.responseId;
        }
        if (hasResponses) {
            for (const item of generatedItems) {
                const rawItem = item.rawItem;
                if (!rawItem || typeof rawItem !== 'object') {
                    continue;
                }
                const rawItemKey = (0, items_1.getAgentInputItemKey)(rawItem);
                if (this.serverItems.has(rawItem) || serverItemKeys.has(rawItemKey)) {
                    this.sentItems.add(rawItem);
                }
            }
        }
    }
    /**
     * Records the raw items returned by the server so future delta calculations skip them.
     * Also captures the latest response identifier to chain follow-up calls when possible.
     */
    trackServerItems(modelResponse) {
        if (!modelResponse) {
            return;
        }
        for (const item of modelResponse.output) {
            if (item && typeof item === 'object') {
                this.serverItems.add(item);
            }
        }
        if (!this.conversationId && modelResponse.responseId) {
            this.previousResponseId = modelResponse.responseId;
        }
    }
    /**
     * Returns the minimum set of items that still need to be delivered to the server for the
     * current turn. This includes the original turn inputs (until acknowledged) plus any
     * newly generated items that have not yet been echoed back by the API.
     */
    prepareInput(originalInput, generatedItems) {
        const inputItems = [];
        if (!this.sentInitialInput) {
            const initialItems = (0, items_1.toAgentInputList)(originalInput);
            // Preserve the full initial payload so a filter can drop items without losing their originals.
            inputItems.push(...initialItems);
            this.remainingInitialInput = initialItems.filter((item) => Boolean(item) && typeof item === 'object');
            this.sentInitialInput = true;
        }
        else if (this.remainingInitialInput &&
            this.remainingInitialInput.length > 0) {
            // Re-queue prior initial items until the tracker confirms they were delivered to the API.
            inputItems.push(...this.remainingInitialInput);
        }
        for (const item of generatedItems) {
            if (item.type === 'tool_approval_item') {
                continue;
            }
            const rawItem = item.rawItem;
            if (!rawItem || typeof rawItem !== 'object') {
                continue;
            }
            if (this.sentItems.has(rawItem) || this.serverItems.has(rawItem)) {
                continue;
            }
            inputItems.push(rawItem);
        }
        return inputItems;
    }
    /**
     * Marks the provided originals as delivered so future turns do not resend them and any
     * pending initial inputs can be dropped once the server acknowledges receipt.
     */
    markInputAsSent(items, options) {
        const delivered = new Set();
        const dropRemainingInitialInput = options?.filterApplied ?? false;
        const markFilteredItemsAsSent = options?.filterApplied && Boolean(options.allTurnItems);
        this.addDeliveredItems(delivered, items);
        const allTurnItems = options?.allTurnItems;
        if (markFilteredItemsAsSent && allTurnItems) {
            this.addDeliveredItems(delivered, allTurnItems);
        }
        this.updateRemainingInitialInput(delivered, Boolean(dropRemainingInitialInput));
    }
    addDeliveredItems(delivered, items) {
        for (const item of items) {
            if (!item || typeof item !== 'object' || delivered.has(item)) {
                continue;
            }
            // Some inputs may be repeated in the filtered list; only mark unique originals once.
            delivered.add(item);
            this.sentItems.add(item);
        }
    }
    updateRemainingInitialInput(delivered, dropRemainingInitialInput) {
        if (!this.remainingInitialInput ||
            this.remainingInitialInput.length === 0 ||
            delivered.size === 0) {
            if (dropRemainingInitialInput && this.remainingInitialInput) {
                this.remainingInitialInput = null;
            }
            return;
        }
        this.remainingInitialInput = this.remainingInitialInput.filter((item) => !delivered.has(item));
        if (this.remainingInitialInput.length === 0) {
            this.remainingInitialInput = null;
        }
        else if (dropRemainingInitialInput) {
            this.remainingInitialInput = null;
        }
    }
}
exports.ServerConversationTracker = ServerConversationTracker;
//# sourceMappingURL=conversation.js.map