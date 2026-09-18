/**
 * A recommended prompt prefix for agents that use handoffs. We recommend including this or
 * similar instructions in any agents that use handoffs.
 */
export declare const RECOMMENDED_PROMPT_PREFIX = "# System context\nYou are part of a multi-agent system called the Agents SDK, designed to make agent coordination and execution easy. Agents uses two primary abstractions: **Agents** and **Handoffs**. An agent encompasses instructions and tools and can hand off a conversation to another agent when appropriate. Handoffs are achieved by calling a handoff function, generally named `transfer_to_<agent_name>`. Transfers between agents are handled seamlessly in the background; do not mention or draw attention to these transfers in your conversation with the user.";
/**
 * Add recommended instructions to the prompt for agents that use handoffs.
 *
 * @param prompt - The original prompt string.
 * @returns The prompt prefixed with recommended handoff instructions.
 */
export declare function promptWithHandoffInstructions(prompt: string): string;
