import { AssistantContent, AssistantMessageItem, SystemMessageItem, UserContent, UserMessageItem } from '../types/protocol';
/**
 * Creates a user message entry
 *
 * @param input The input message from the user.
 * @param options Any additional options that will be directly passed to the model.
 * @returns A message entry.
 */
export declare function user(input: string | UserContent[], options?: Record<string, any>): UserMessageItem;
/**
 * Creates a system message entry
 *
 * @param input The system prompt.
 * @param options Any additional options that will be directly passed to the model.
 * @returns A message entry.
 */
export declare function system(input: string, options?: Record<string, any>): SystemMessageItem;
/**
 * Creates an assistant message entry for example for multi-shot prompting
 *
 * @param content The assistant response.
 * @param options Any additional options that will be directly passed to the model.
 * @returns A message entry.
 */
export declare function assistant(content: string | AssistantContent[], options?: Record<string, any>): AssistantMessageItem;
