import { randomUUID } from '@openai/agents-core/_shims';
import { logger } from "../logger.mjs";
/**
 * Simple in-memory session store intended for demos or tests. Not recommended for production use.
 */
export class MemorySession {
    sessionId;
    logger;
    items;
    constructor(options = {}) {
        this.sessionId = options.sessionId ?? randomUUID();
        this.items = options.initialItems
            ? options.initialItems.map(cloneAgentItem)
            : [];
        this.logger = options.logger ?? logger;
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
function cloneAgentItem(item) {
    return structuredClone(item);
}
//# sourceMappingURL=memorySession.mjs.map