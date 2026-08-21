/**
 * `$HOME/.langy-worker.json`, written by the manager's Provision step before
 * spawn. Secrets stay in the environment; the config references env var NAMES
 * (`baseUrlEnv`, `apiKeyEnv`). Unknown model keys pass through verbatim into
 * the generated pi model entry so new compat findings drop in without a
 * wrapper change.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const modelConfigSchema = z
  .object({
    id: z.string().min(1),
    api: z.enum(["openai-completions", "openai-responses", "anthropic-messages"]),
    baseUrlEnv: z.string().min(1),
    apiKeyEnv: z.string().min(1),
    reasoning: z.boolean().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    compat: z.record(z.unknown()).optional(),
  })
  .passthrough();

const configSchema = z.object({
  model: modelConfigSchema,
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  personaPrompt: z.string(),
  agentsFilePath: z.string().min(1),
  skillsDir: z.string().optional(),
  sessionDir: z.string().min(1),
});

export type LangyWorkerModelConfig = z.infer<typeof modelConfigSchema>;
export type LangyWorkerConfig = z.infer<typeof configSchema>;

export const CONFIG_FILE_NAME = ".langy-worker.json";

export function parseConfig(raw: string): LangyWorkerConfig {
  const parsed = configSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`invalid ${CONFIG_FILE_NAME}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

export function loadConfig(home: string): LangyWorkerConfig {
  const path = join(home, CONFIG_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseConfig(raw);
}
