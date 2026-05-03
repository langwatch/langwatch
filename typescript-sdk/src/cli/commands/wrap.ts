import { runWrapped } from "@/cli/utils/governance/wrapper";

/**
 * Tiny shim — each `langwatch <tool>` subcommand delegates to
 * `runWrapped(tool, args)` which loads the device-flow config,
 * pre-checks budget, and exec's the underlying binary with the
 * right env vars injected.
 */
export const wrapClaude = async (args: string[]): Promise<void> => {
  await runWrapped("claude", args);
};

export const wrapCodex = async (args: string[]): Promise<void> => {
  await runWrapped("codex", args);
};

export const wrapCursor = async (args: string[]): Promise<void> => {
  await runWrapped("cursor", args);
};

export const wrapGemini = async (args: string[]): Promise<void> => {
  await runWrapped("gemini", args);
};
