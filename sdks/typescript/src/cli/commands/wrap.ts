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

export const wrapCopilot = async (args: string[]): Promise<void> => {
  await runWrapped("copilot", args);
};

export const wrapCode = async (args: string[]): Promise<void> => {
  // VS Code hands `code <args>` to an ALREADY-RUNNING instance when one
  // exists (`openExistingWindow` reuses the live extension host, which never
  // sees this launch's env). Capture only applies to windows this launch
  // creates — say so up front instead of silently not capturing.
  process.stderr.write(
    "[langwatch] capture applies to VS Code windows opened by this launch; if VS Code is already running, close it first (or run `code -n`) so Copilot Chat picks up the telemetry env.\n",
  );
  await runWrapped("code", args);
};

export const wrapCursor = async (args: string[]): Promise<void> => {
  await runWrapped("cursor", args);
};

export const wrapGemini = async (args: string[]): Promise<void> => {
  await runWrapped("gemini", args);
};

export const wrapOpencode = async (args: string[]): Promise<void> => {
  await runWrapped("opencode", args);
};
