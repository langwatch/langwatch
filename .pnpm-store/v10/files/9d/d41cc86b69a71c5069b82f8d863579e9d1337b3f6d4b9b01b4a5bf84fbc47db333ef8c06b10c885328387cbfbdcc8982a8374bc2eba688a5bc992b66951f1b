"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIConversationsSession = void 0;
exports.startOpenAIConversationsSession = startOpenAIConversationsSession;
const openai_1 = __importDefault(require("openai"));
const defaults_1 = require("../defaults.js");
const openaiResponsesModel_1 = require("../openaiResponsesModel.js");
const openaiSessionApi_1 = require("./openaiSessionApi.js");
async function startOpenAIConversationsSession(client) {
    const resolvedClient = client ?? resolveClient({});
    const response = await resolvedClient.conversations.create({ items: [] });
    return response.id;
}
class OpenAIConversationsSession {
    // Marks this session as backed by the Conversations API so Responses-only integrations can reject it.
    [openaiSessionApi_1.OPENAI_SESSION_API] = 'conversations';
    #client;
    #conversationId;
    constructor(options = {}) {
        this.#client = resolveClient(options);
        this.#conversationId = options.conversationId;
    }
    get sessionId() {
        return this.#conversationId;
    }
    async getSessionId() {
        if (!this.#conversationId) {
            this.#conversationId = await startOpenAIConversationsSession(this.#client);
        }
        return this.#conversationId;
    }
    async getItems(limit) {
        const conversationId = await this.getSessionId();
        // Convert each API item into the Agent SDK's input shape. Some API payloads expand into multiple items.
        const toAgentItems = (item) => {
            if (item.type === 'message' && item.role === 'user') {
                const message = item;
                return [
                    {
                        id: item.id,
                        type: 'message',
                        role: 'user',
                        content: (message.content ?? [])
                            .map((c) => {
                            if (c.type === 'input_text') {
                                return { type: 'input_text', text: c.text };
                            }
                            else if (c.type === 'input_image') {
                                if (c.image_url) {
                                    return { type: 'input_image', image: c.image_url };
                                }
                                else if (c.file_id) {
                                    return { type: 'input_image', image: { id: c.file_id } };
                                }
                            }
                            else if (c.type === 'input_file') {
                                if (c.file_data) {
                                    const fileItem = {
                                        type: 'input_file',
                                        file: c.file_data,
                                    };
                                    if (c.filename) {
                                        fileItem.filename = c.filename;
                                    }
                                    return fileItem;
                                }
                                if (c.file_url) {
                                    const fileItem = {
                                        type: 'input_file',
                                        file: c.file_url,
                                    };
                                    if (c.filename) {
                                        fileItem.filename = c.filename;
                                    }
                                    return fileItem;
                                }
                                else if (c.file_id) {
                                    const fileItem = {
                                        type: 'input_file',
                                        file: { id: c.file_id },
                                    };
                                    if (c.filename) {
                                        fileItem.filename = c.filename;
                                    }
                                    return fileItem;
                                }
                            }
                            // Add more content types here when they're added
                            return null;
                        })
                            .filter((c) => c !== null),
                    },
                ];
            }
            const outputItems = item
                .output;
            if (isResponseOutputItemArray(outputItems)) {
                return (0, openaiResponsesModel_1.convertToOutputItem)(outputItems);
            }
            return (0, openaiResponsesModel_1.convertToOutputItem)([item]);
        };
        if (limit === undefined) {
            const items = [];
            const iterator = this.#client.conversations.items.list(conversationId, {
                order: 'asc',
            });
            for await (const item of iterator) {
                items.push(...toAgentItems(item));
            }
            return items;
        }
        if (limit <= 0) {
            return [];
        }
        const itemGroups = [];
        let total = 0;
        const iterator = this.#client.conversations.items.list(conversationId, {
            limit,
            order: 'desc',
        });
        for await (const item of iterator) {
            const group = toAgentItems(item);
            if (!group.length) {
                continue;
            }
            itemGroups.push(group);
            total += group.length;
            if (total >= limit) {
                break;
            }
        }
        // Iterate in reverse because the API returned items in descending order.
        const orderedItems = [];
        for (let index = itemGroups.length - 1; index >= 0; index -= 1) {
            orderedItems.push(...itemGroups[index]);
        }
        if (orderedItems.length > limit) {
            orderedItems.splice(0, orderedItems.length - limit);
        }
        return orderedItems;
    }
    async addItems(items) {
        if (!items.length) {
            return;
        }
        const conversationId = await this.getSessionId();
        const sanitizedItems = stripIdsAndProviderData(items);
        await this.#client.conversations.items.create(conversationId, {
            items: (0, openaiResponsesModel_1.getInputItems)(sanitizedItems),
        });
    }
    async popItem() {
        const conversationId = await this.getSessionId();
        const [latest] = await this.getItems(1);
        if (!latest) {
            return undefined;
        }
        const itemId = latest.id;
        if (itemId) {
            await this.#client.conversations.items.delete(itemId, {
                conversation_id: conversationId,
            });
        }
        return latest;
    }
    async clearSession() {
        if (!this.#conversationId) {
            return;
        }
        await this.#client.conversations.delete(this.#conversationId);
        this.#conversationId = undefined;
    }
}
exports.OpenAIConversationsSession = OpenAIConversationsSession;
// --------------------------------------------------------------
//  Internals
// --------------------------------------------------------------
function stripIdsAndProviderData(items) {
    return items.map((item) => {
        if (Array.isArray(item) || item === null || typeof item !== 'object') {
            return item;
        }
        // Conversations API rejects unknown top-level fields (e.g., model merged from providerData).
        // Only strip providerData.model from message-like items; keep IDs intact for tool linkage.
        const rest = { ...item };
        const providerData = item.providerData;
        if (providerData &&
            typeof providerData === 'object' &&
            !Array.isArray(providerData)) {
            const pdObj = providerData;
            const { model: _model, ...pdRest } = pdObj;
            rest.providerData =
                Object.keys(pdRest).length > 0 ? pdRest : undefined;
        }
        return rest;
    });
}
const INPUT_CONTENT_TYPES = new Set([
    'input_text',
    'input_image',
    'input_file',
    'input_audio',
]);
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
// Treats a value as ResponseOutputItem[] only when each entry resembles an output item rather than raw input content.
function isResponseOutputItemArray(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return false;
    }
    return value.every((entry) => {
        if (!isObject(entry)) {
            return false;
        }
        const type = entry.type;
        if (typeof type !== 'string') {
            return false;
        }
        if (INPUT_CONTENT_TYPES.has(type)) {
            return false;
        }
        // Fallback: pre-emptively exclude future input_* variants so they never masquerade as response outputs.
        return !type.startsWith('input_');
    });
}
function resolveClient(options) {
    if (options.client) {
        return options.client;
    }
    return ((0, defaults_1.getDefaultOpenAIClient)() ??
        new openai_1.default({
            apiKey: options.apiKey ?? (0, defaults_1.getDefaultOpenAIKey)(),
            baseURL: options.baseURL,
            organization: options.organization,
            project: options.project,
        }));
}
//# sourceMappingURL=openaiConversationsSession.js.map