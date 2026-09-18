"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIResponsesCompactionSession = void 0;
const openai_1 = __importDefault(require("openai"));
const agents_core_1 = require("@openai/agents-core");
const defaults_1 = require("../defaults.js");
const openaiSessionApi_1 = require("./openaiSessionApi.js");
const DEFAULT_COMPACTION_THRESHOLD = 10;
const logger = (0, agents_core_1.getLogger)('openai-agents:openai:compaction');
/**
 * Session decorator that triggers `responses.compact` when the stored history grows.
 *
 * This session is intended to be passed to `run()` so the runner can automatically supply the
 * latest `responseId` and invoke compaction after each completed turn is persisted.
 *
 * To debug compaction decisions, enable the `debug` logger for
 * `openai-agents:openai:compaction` (for example, `DEBUG=openai-agents:openai:compaction`).
 */
class OpenAIResponsesCompactionSession {
    [openaiSessionApi_1.OPENAI_SESSION_API] = 'responses';
    client;
    underlyingSession;
    model;
    responseId;
    shouldTriggerCompaction;
    compactionCandidateItems;
    sessionItems;
    constructor(options) {
        this.client = resolveClient(options);
        if (isOpenAIConversationsSessionDelegate(options.underlyingSession)) {
            throw new agents_core_1.UserError('OpenAIResponsesCompactionSession does not support OpenAIConversationsSession as an underlying session.');
        }
        this.underlyingSession = options.underlyingSession ?? new agents_core_1.MemorySession();
        const model = (options.model ?? defaults_1.DEFAULT_OPENAI_MODEL).trim();
        assertSupportedOpenAIResponsesCompactionModel(model);
        this.model = model;
        this.shouldTriggerCompaction =
            options.shouldTriggerCompaction ?? defaultShouldTriggerCompaction;
        this.compactionCandidateItems = undefined;
        this.sessionItems = undefined;
    }
    async runCompaction(args = {}) {
        this.responseId = args.responseId ?? this.responseId ?? undefined;
        if (!this.responseId) {
            throw new agents_core_1.UserError('OpenAIResponsesCompactionSession.runCompaction requires a responseId from the last completed turn.');
        }
        const { compactionCandidateItems, sessionItems } = await this.ensureCompactionCandidates();
        const shouldTriggerCompaction = args.force === true
            ? true
            : await this.shouldTriggerCompaction({
                responseId: this.responseId,
                compactionCandidateItems,
                sessionItems,
            });
        if (!shouldTriggerCompaction) {
            logger.debug('skip: decision hook %o', {
                responseId: this.responseId,
            });
            return null;
        }
        logger.debug('compact: start %o', {
            responseId: this.responseId,
            model: this.model,
        });
        const compacted = await this.client.responses.compact({
            previous_response_id: this.responseId,
            model: this.model,
        });
        await this.underlyingSession.clearSession();
        const outputItems = (compacted.output ?? []);
        if (outputItems.length > 0) {
            await this.underlyingSession.addItems(outputItems);
        }
        this.compactionCandidateItems = selectCompactionCandidateItems(outputItems);
        this.sessionItems = outputItems;
        logger.debug('compact: done %o', {
            responseId: this.responseId,
            outputItemCount: outputItems.length,
            candidateCount: this.compactionCandidateItems.length,
        });
        return {
            usage: toRequestUsage(compacted.usage),
        };
    }
    async getSessionId() {
        return this.underlyingSession.getSessionId();
    }
    async getItems(limit) {
        return this.underlyingSession.getItems(limit);
    }
    async addItems(items) {
        if (items.length === 0) {
            return;
        }
        await this.underlyingSession.addItems(items);
        if (this.compactionCandidateItems) {
            const candidates = selectCompactionCandidateItems(items);
            if (candidates.length > 0) {
                this.compactionCandidateItems = [
                    ...this.compactionCandidateItems,
                    ...candidates,
                ];
            }
        }
        if (this.sessionItems) {
            this.sessionItems = [...this.sessionItems, ...items];
        }
    }
    async popItem() {
        const popped = await this.underlyingSession.popItem();
        if (!popped) {
            return popped;
        }
        if (this.sessionItems) {
            const index = this.sessionItems.lastIndexOf(popped);
            if (index >= 0) {
                this.sessionItems.splice(index, 1);
            }
            else {
                this.sessionItems = await this.underlyingSession.getItems();
            }
        }
        if (this.compactionCandidateItems) {
            const isCandidate = selectCompactionCandidateItems([popped]).length > 0;
            if (isCandidate) {
                const index = this.compactionCandidateItems.indexOf(popped);
                if (index >= 0) {
                    this.compactionCandidateItems.splice(index, 1);
                }
                else {
                    // Fallback when the popped item reference differs from stored candidates.
                    this.compactionCandidateItems = selectCompactionCandidateItems(await this.underlyingSession.getItems());
                }
            }
        }
        return popped;
    }
    async clearSession() {
        await this.underlyingSession.clearSession();
        this.compactionCandidateItems = [];
        this.sessionItems = [];
    }
    async ensureCompactionCandidates() {
        if (this.compactionCandidateItems && this.sessionItems) {
            logger.debug('candidates: cached %o', {
                candidateCount: this.compactionCandidateItems.length,
            });
            return {
                compactionCandidateItems: [...this.compactionCandidateItems],
                sessionItems: [...this.sessionItems],
            };
        }
        const history = await this.underlyingSession.getItems();
        const compactionCandidates = selectCompactionCandidateItems(history);
        this.compactionCandidateItems = compactionCandidates;
        this.sessionItems = history;
        logger.debug('candidates: initialized %o', {
            historyLength: history.length,
            candidateCount: compactionCandidates.length,
        });
        return {
            compactionCandidateItems: [...compactionCandidates],
            sessionItems: [...history],
        };
    }
}
exports.OpenAIResponsesCompactionSession = OpenAIResponsesCompactionSession;
function resolveClient(options) {
    if (options.client) {
        return options.client;
    }
    const defaultClient = (0, defaults_1.getDefaultOpenAIClient)();
    if (defaultClient) {
        return defaultClient;
    }
    return new openai_1.default();
}
function defaultShouldTriggerCompaction({ compactionCandidateItems, }) {
    return compactionCandidateItems.length >= DEFAULT_COMPACTION_THRESHOLD;
}
function selectCompactionCandidateItems(items) {
    return items.filter((item) => {
        if (item.type === 'compaction') {
            return false;
        }
        return !(item.type === 'message' && item.role === 'user');
    });
}
function assertSupportedOpenAIResponsesCompactionModel(model) {
    if (!isOpenAIModelName(model)) {
        throw new Error(`Unsupported model for OpenAI responses compaction: ${JSON.stringify(model)}`);
    }
}
function isOpenAIModelName(model) {
    const trimmed = model.trim();
    if (!trimmed) {
        return false;
    }
    // The OpenAI SDK does not ship a runtime allowlist of model names.
    // This check relies on common model naming conventions and intentionally allows unknown `gpt-*` variants.
    // Fine-tuned model IDs typically look like: ft:gpt-4o-mini:org:project:suffix.
    const withoutFineTunePrefix = trimmed.startsWith('ft:')
        ? trimmed.slice('ft:'.length)
        : trimmed;
    const root = withoutFineTunePrefix.split(':', 1)[0];
    // Allow unknown `gpt-*` variants to avoid needing updates whenever new models ship.
    if (root.startsWith('gpt-')) {
        return true;
    }
    // Allow the `o*` reasoning models
    if (/^o\d[a-z0-9-]*$/i.test(root)) {
        return true;
    }
    return false;
}
function toRequestUsage(usage) {
    return new agents_core_1.RequestUsage({
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        inputTokensDetails: { ...usage?.input_tokens_details },
        outputTokensDetails: { ...usage?.output_tokens_details },
        endpoint: 'responses.compact',
    });
}
function isOpenAIConversationsSessionDelegate(underlyingSession) {
    return (!!underlyingSession &&
        typeof underlyingSession === 'object' &&
        openaiSessionApi_1.OPENAI_SESSION_API in underlyingSession &&
        underlyingSession[openaiSessionApi_1.OPENAI_SESSION_API] === 'conversations');
}
//# sourceMappingURL=openaiResponsesCompactionSession.js.map