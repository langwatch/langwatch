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
  /**
   * Whether the pre-execution delete gate is registered (issue #7608). Resolved
   * server-side from `release_langy_delete_gate` and written into the config by
   * the manager. ABSENT means ON: a config that predates the flag, or a manager
   * that failed to resolve it, still gets the gate — the fail-safe direction. A
   * literal `false` (the flag resolved OFF) is the only value that unregisters
   * it. Not folded into the worker signature: a flip takes effect on the next
   * warm/probe-MISS re-warm, not on a live worker (flip latency is a non-goal).
   */
  deleteGateEnabled: z.boolean().optional(),
});

export type LangyWorkerModelConfig = z.infer<typeof modelConfigSchema>;
export type LangyWorkerConfig = z.infer<typeof configSchema>;

export const CONFIG_FILE_NAME = ".langy-worker.json";

export function parseConfig(raw: string): LangyWorkerConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid ${CONFIG_FILE_NAME}: not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = configSchema.safeParse(json);
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
