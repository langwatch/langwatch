import type { AgentAdapter } from "@langwatch/scenario";

/**
 * Declares what a code assistant supports for skill testing.
 */
export interface AgentRunnerCapabilities {
  /** Whether the assistant can use MCP tools. */
  supportsMcp: boolean;
  /** Directory where skills are placed relative to the working directory. */
  skillsDirectory: string;
  /** Assistant-specific config file name (e.g., "CLAUDE.md"). */
  configFile?: string;
}

/**
 * Options passed to a runner when creating an agent for a test run.
 */
export interface RunnerOptions {
  /** Temp directory where the test runs. */
  workingDirectory: string;
  /** Path to a SKILL.md to copy into the working directory. */
  skillPath?: string;
  /** Strip API keys from the spawned process environment. */
  cleanEnv?: boolean;
  /** Omit MCP configuration entirely. */
  skipMcp?: boolean;
}

/**
 * Interface that all code assistant adapters implement.
 *
 * Each runner encapsulates assistant-specific details: binary invocation,
 * output parsing, skill directory placement, and permission flags.
 */
export interface AgentRunner {
  /** Identifier for the assistant (e.g., "claude-code", "codex", "cursor"). */
  name: string;
  /** What the assistant supports. */
  capabilities: AgentRunnerCapabilities;
  /**
   * Create an AgentAdapter that spawns the assistant binary and
   * parses its output into the @langwatch/scenario format.
   */
  createAgent(options: RunnerOptions): AgentAdapter;
}
