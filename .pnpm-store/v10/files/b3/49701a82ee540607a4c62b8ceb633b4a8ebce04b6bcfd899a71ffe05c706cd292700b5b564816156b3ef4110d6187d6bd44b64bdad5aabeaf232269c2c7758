"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemorySession = void 0;
const _shims_1 = require("@openai/agents-core/_shims");
const logger_1 = require("../logger.js");
/**
 * Simple in-memory session store intended for demos or tests. Not recommended for production use.
 */
class MemorySession {
    sessionId;
    logger;
    items;
    constructor(options = {}) {
        this.sessionId = options.sessionId ?? (0, _shims_1.randomUUID)();
        this.items = options.initialItems
            ? options.initialItems.map(cloneAgentItem)
            : [];
        this.logger = options.logger ?? logger_1.logger;
    }
    async getSessionId() {
        return this.sessionId;
    }
    async getItems(limit) {
        if (limit === undefined) {
            const cloned = this.items.map(cloneAgentItem);
            this.logger.debug(`Getting items from memory session (${this.sessionId}): ${JSON.stringify(cloned)}`);
            return cloned;
        }
        if (limit <= 0) {
            return [];
        }
        const start = Math.max(this.items.length - limit, 0);
        const items = this.items.slice(start).map(cloneAgentItem);
        this.logger.debug(`Getting items from memory session (${this.sessionId}): ${JSON.stringify(items)}`);
        return items;
    }
    async addItems(items) {
        if (items.length === 0) {
            return;
        }
        const cloned = items.map(cloneAgentItem);
        this.logger.debug(`Adding items to memory session (${this.sessionId}): ${JSON.stringify(cloned)}`);
        this.items = [...this.items, ...cloned];
    }
    async popItem() {
        if (this.items.length === 0) {
            return undefined;
        }
        const item = this.items[this.items.length - 1];
        const cloned = cloneAgentItem(item);
        this.logger.debug(`Popping item from memory session (${this.sessionId}): ${JSON.stringify(cloned)}`);
        this.items = this.items.slice(0, -1);
        return cloned;
    }
    async clearSession() {
        this.logger.debug(`Clearing memory session (${this.sessionId})`);
        this.items = [];
    }
}
exports.MemorySession = MemorySession;
function cloneAgentItem(item) {
    return structuredClone(item);
}
//# sourceMappingURL=memorySession.js.map