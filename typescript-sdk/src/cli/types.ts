import { z } from "zod";

export type PromptDependency =
  | string
  | {
      version?: string;
      file?: string;
    };

export type PromptsConfig = {
  prompts: Record<string, PromptDependency>;
};

// Zod schema for local prompt config with permissive validation
export const localPromptConfigSchema = z
  .object({
    model: z.string().min(1, "Model is required"),
    modelParameters: z
      .object({
        temperature: z.number().optional(),
        max_tokens: z.number().optional(),
      })
      .loose()
      .optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string().min(1, "Message content cannot be empty"),
          })
          .loose(),
      )
      .min(1, "At least one message is required"),
  })
  .loose();

export type LocalPromptConfig = z.infer<typeof localPromptConfigSchema>;

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
