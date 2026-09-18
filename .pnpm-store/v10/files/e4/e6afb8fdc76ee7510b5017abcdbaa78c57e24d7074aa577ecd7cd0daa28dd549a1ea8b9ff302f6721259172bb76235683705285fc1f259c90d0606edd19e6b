import { RunItem } from '../items';
import { AgentInputItem } from '../types';
export type AgentInputItemPool = Map<string, AgentInputItem[]>;
export declare function toAgentInputList(originalInput: string | AgentInputItem[]): AgentInputItem[];
export declare function getAgentInputItemKey(item: AgentInputItem): string;
export declare function buildAgentInputPool(items: AgentInputItem[]): AgentInputItemPool;
export declare function takeAgentInputFromPool(pool: AgentInputItemPool, key: string): AgentInputItem | undefined;
export declare function removeAgentInputFromPool(pool: AgentInputItemPool, item: AgentInputItem): boolean;
export declare function agentInputSerializationReplacer(_key: string, value: unknown): unknown;
export declare function extractOutputItemsFromRunItems(items: RunItem[]): AgentInputItem[];
/**
 * Constructs the model input array for the current turn by combining the original turn input with
 * any new run items (excluding tool approval placeholders). This helps ensure that repeated calls
 * to the Responses API only send newly generated content.
 *
 * See: https://platform.openai.com/docs/guides/conversation-state?api-mode=responses.
 */
export declare function getTurnInput(originalInput: string | AgentInputItem[], generatedItems: RunItem[]): AgentInputItem[];
