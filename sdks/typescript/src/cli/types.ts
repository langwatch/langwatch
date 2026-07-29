// NOTE: this module must stay ZOD-FREE. It is imported by `program.ts`, the
// always-loaded cold-start path of every CLI invocation, and zod costs ~39ms
// to load. The zod-based local prompt config schema lives in
// `types-prompt.ts`, which only the (lazy-loaded) prompt commands pull in.

// Type-only re-export, so existing `import type { LocalPromptConfig } from
// ".../types"` callers keep working without a runtime edge to zod.
export type { LocalPromptConfig } from "./types-prompt";

export type PromptDependency =
  | string
  | {
      version?: string;
      file?: string;
    };

export type PromptsConfig = {
  prompts: Record<string, PromptDependency>;
};

export type RuntimeParameters = Record<string, unknown>;

export type MaterializedPrompt = {
  id: string;
  name: string;
  version: number;
  versionId: string;
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  inputs?: any;
  outputs?: any;
  parameters: RuntimeParameters;
  updatedAt: string;
};

export type SyncResult = {
  fetched: Array<{ name: string; version: number; versionSpec: string }>;
  pushed: Array<{ name: string; version: number }>;
  unchanged: string[];
  cleaned: string[];
  errors: Array<{ name: string; error: string }>;
};

export type PromptsLockEntry = {
  version: number;
  versionId: string;
  materialized: string;
};

export type PromptsLock = {
  lockfileVersion: number;
  prompts: Record<string, PromptsLockEntry>;
};

// Parse npm-style version specifications like "foo@latest" or "bar@5"
export const parsePromptSpec = (
  spec: string,
): { name: string; version: string } => {
  const atIndex = spec.lastIndexOf("@");
  if (atIndex === -1) {
    return { name: spec, version: "latest" };
  }

  const name = spec.slice(0, atIndex);
  const version = spec.slice(atIndex + 1);

  if (!name || !version) {
    throw new Error(
      `Invalid prompt specification: ${spec}. Use format 'name@version' or just 'name'`,
    );
  }

  return { name, version };
};
