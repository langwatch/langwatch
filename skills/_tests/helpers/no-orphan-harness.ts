/**
 * Stands in for a vitest worker that is running Claude Code, for
 * `no-orphan-process.test.ts`. It builds the same agent the skill scenario
 * tests build and starts one turn, which never returns: the test puts a fake
 * `claude` on the agent's PATH that keeps running until something kills it.
 *
 * The test kills this process without warning and then checks that the fake
 * `claude`, and the child that fake started, are gone too.
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
