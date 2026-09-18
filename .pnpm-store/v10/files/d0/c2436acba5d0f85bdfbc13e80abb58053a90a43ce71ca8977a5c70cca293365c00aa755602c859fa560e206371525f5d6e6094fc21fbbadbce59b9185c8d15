/**
 * Text chunk sent from your server to ElevenLabs for speech synthesis.
 * Stream LLM output by sending multiple messages with `is_final: false`, then
 * terminate the response with a message where `is_final: true` and `content` is
 * an empty string.
 */
export interface AgentResponsePayload {
    /** The message type identifier. */
    type: "agent_response";
    /**
     * The text to synthesize. For streaming responses, send incremental chunks here.
     * The final message in a response must have an empty string (`""`).
     */
    content: string;
    /**
     * The `event_id` from the `user_transcript` this response addresses. ElevenLabs
     * uses this to discard responses that belong to an interrupted turn.
     */
    eventId?: number;
    /**
     * Set to `true` on the last message of a response (with an empty `content`).
     * Set to `false` on all preceding chunks.
     */
    isFinal: boolean;
}
