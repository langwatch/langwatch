/**
 * Stands in for a vitest worker running Claude Code, for
 * `no-orphan-process.test.ts`: a fake `claude` on PATH runs until killed, so
 * the test can verify it and its child are both gone once this process dies.
 */
import { type AgentInput, AgentRole } from "@langwatch/scenario";

import { createClaudeCodeAgent } from "./claude-code-adapter.js";

const workingDirectory = process.argv[2];
if (!workingDirectory) {
  throw new Error("usage: no-orphan-harness <workingDirectory>");
}

const agent = createClaudeCodeAgent({ workingDirectory });

// The Claude Code adapter reads the thread id and the messages, so the rest of
// AgentInput, which only a real scenario run can build, stays out of the turn.
const input = {
  threadId: "no-orphan",
  messages: [{ role: "user" as const, content: "hang" }],
  newMessages: [{ role: "user" as const, content: "hang" }],
  requestedRole: AgentRole.AGENT,
} satisfies Partial<AgentInput>;

await agent.call(input as AgentInput);
