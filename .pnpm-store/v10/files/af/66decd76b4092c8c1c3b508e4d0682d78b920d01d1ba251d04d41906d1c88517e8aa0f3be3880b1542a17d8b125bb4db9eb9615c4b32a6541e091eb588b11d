import type { AgentInputItem } from '../types';
import type { Session } from './session';
import { Logger } from '../logger';
export type MemorySessionOptions = {
    sessionId?: string;
    initialItems?: AgentInputItem[];
    logger?: Logger;
};
/**
 * Simple in-memory session store intended for demos or tests. Not recommended for production use.
 */
export declare class MemorySession implements Session {
    private readonly sessionId;
    private readonly logger;
    private items;
    constructor(options?: MemorySessionOptions);
    getSessionId(): Promise<string>;
    getItems(limit?: number): Promise<AgentInputItem[]>;
    addItems(items: AgentInputItem[]): Promise<void>;
    popItem(): Promise<AgentInputItem | undefined>;
    clearSession(): Promise<void>;
}
