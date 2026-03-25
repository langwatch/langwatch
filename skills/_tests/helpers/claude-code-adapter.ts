/**
 * Legacy re-export module for backward compatibility.
 *
 * Existing test files import from this path. These exports delegate
 * to the new runner-based module locations.
 *
 * @deprecated Import from `./agent-factory` or `./shared` instead.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import { ClaudeCodeRunner } from "./runners/claude-code.js";
import { toolCallFix as _toolCallFix } from "./shared.js";

export { toolCallFix } from "./shared.js";

/**
 * Creates a Claude Code agent adapter for use with @langwatch/scenario.
 *
 * @deprecated Use `createAgent()` from `./agent-factory` instead.
 */
export function createClaudeCodeAgent({
  workingDirectory,
  skillPath,
  cleanEnv,
  skipMcp,
}: {
  workingDirectory: string;
  skillPath?: string;
  cleanEnv?: boolean;
  skipMcp?: boolean;
}): AgentAdapter {
  const runner = new ClaudeCodeRunner();
  return runner.createAgent({ workingDirectory, skillPath, cleanEnv, skipMcp });
}
