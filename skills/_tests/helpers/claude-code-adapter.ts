/**
 * Backward-compatibility re-exports.
 *
 * Existing test files import `createClaudeCodeAgent`, `toolCallFix`, and
 * `assertSkillWasRead` from this module. `createClaudeCodeAgent` always
 * returns a Claude Code runner regardless of `AGENT_UNDER_TEST`, since
 * the name explicitly promises Claude Code semantics.
 */

import { ClaudeCodeRunner } from "./runners/claude-code.js";
import type { RunnerOptions } from "./types.js";

export function createClaudeCodeAgent(options: RunnerOptions) {
  const runner = new ClaudeCodeRunner();
  return runner.createAgent(options);
}

export { toolCallFix, assertSkillWasRead } from "./shared.js";
