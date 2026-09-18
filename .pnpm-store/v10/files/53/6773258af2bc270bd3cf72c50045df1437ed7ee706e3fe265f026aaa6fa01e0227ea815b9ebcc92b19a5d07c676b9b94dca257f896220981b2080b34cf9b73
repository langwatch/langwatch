/**
 * Branding symbol used to tag OpenAI-backed sessions with the underlying API family they rely on.
 *
 * This enables runtime checks (and some type narrowing) to prevent mixing sessions that are not
 * compatible with each other (e.g., using a Conversations-based session where a Responses-only
 * feature is required).
 */
export declare const OPENAI_SESSION_API: unique symbol;
export type OpenAISessionAPI = 'responses' | 'conversations';
export type OpenAISessionApiTagged<API extends OpenAISessionAPI> = {
    readonly [OPENAI_SESSION_API]: API;
};
