// Connects the OWASP pack to the agent under test. Wire callAgent and nothing else.
import scenario, {
  type AgentAdapter,
  type AgentInput,
  type AgentReturnTypes,
} from "@langwatch/scenario";

/**
 * Run your agent on the conversation so far and return its reply: a string,
 * one message, or the list of new messages. Return the tool call and tool
 * result messages too: the judge needs them to see tool use.
 */
export async function callAgent({
  messages,
}: {
  messages: AgentInput["messages"];
}): Promise<AgentReturnTypes> {
  // Example: return await runAgent({ messages });
  void messages;
  throw new Error("Wire your agent in agent-adapter.ts callAgent before running the OWASP pack");
}

export const owaspTargetAdapter: AgentAdapter = {
  role: scenario.AgentRole.AGENT,
  async call(input: AgentInput) {
    return await callAgent({ messages: input.messages });
  },
};
