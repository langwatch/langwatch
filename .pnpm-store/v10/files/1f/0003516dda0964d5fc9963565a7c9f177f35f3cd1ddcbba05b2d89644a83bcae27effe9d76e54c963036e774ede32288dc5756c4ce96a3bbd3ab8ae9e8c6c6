import OpenAI from 'openai';
import type { AgentInputItem, Session } from '@openai/agents-core';
import { OPENAI_SESSION_API, type OpenAISessionApiTagged } from './openaiSessionApi';
export type OpenAIConversationsSessionOptions = {
    conversationId?: string;
    client?: OpenAI;
    apiKey?: string;
    baseURL?: string;
    organization?: string;
    project?: string;
};
export declare function startOpenAIConversationsSession(client?: OpenAI): Promise<string>;
export declare class OpenAIConversationsSession implements Session, OpenAISessionApiTagged<'conversations'> {
    #private;
    readonly [OPENAI_SESSION_API]: "conversations";
    constructor(options?: OpenAIConversationsSessionOptions);
    get sessionId(): string | undefined;
    getSessionId(): Promise<string>;
    getItems(limit?: number): Promise<AgentInputItem[]>;
    addItems(items: AgentInputItem[]): Promise<void>;
    popItem(): Promise<AgentInputItem | undefined>;
    clearSession(): Promise<void>;
}
