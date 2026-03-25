import type { AgentAdapter } from "@langwatch/scenario";

/**
 * Declares what a code assistant runner supports.
 *
 * Each runner uses these to let tests skip gracefully when a capability
 * is missing (e.g. MCP not supported by Codex).
 */
export interface AgentRunnerCapabilities {
  /** Whether the runner supports MCP server configuration. */
  supportsMcp: boolean;
  /** Directory path (relative to working dir) where skills are placed. */
  skillsDirectory: string;
  /** Config file name generated in the working directory, if any. */
  configFile?: string;
}

/**
 * Options passed when creating an agent adapter from a runner.
 */
export interface RunnerOptions {
  /** The directory the spawned assistant process will use as cwd. */
  workingDirectory: string;
  /** Path to a SKILL.md file; the runner copies the skill tree into the working directory. */
  skillPath?: string;
  /** Strip API keys from the spawned environment. */
  cleanEnv?: boolean;
  /** Omit MCP configuration even if the runner supports it. */
  skipMcp?: boolean;
}

/**
 * A code assistant runner that can spawn an agent adapter for scenario tests.
 *
 * Implementations exist for Claude Code and Codex. Each runner normalizes
 * its own output format internally -- callers get a standard AgentAdapter.
 */
export interface AgentRunner {
  /** Human-readable name used for log prefixes and diagnostics. */
  readonly name: string;
  /** Capability declarations for this runner. */
  readonly capabilities: AgentRunnerCapabilities;
  /** Create an AgentAdapter that spawns the assistant binary. */
  createAgent(options: RunnerOptions): AgentAdapter;
}
