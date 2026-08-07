/**
 * Picks the newest "plain" flagship model from the LLM registry for a
 * given provider — `<provider>/<base>-<major>.<minor>` only, skipping
 * specialised variants (pro, codex, image, audio, nano, mini, dated, etc.).
 *
 * Used to derive a sensible "current model" without hard-coding a value
 * that drifts every time the registry advances. Lightweight on purpose
 * (only depends on the JSON registry, no Prisma types) so it's safe to
 * import from leaf modules like `~/utils/constants`.
 */

import { llmModels } from "./loadModelCatalog";

interface RegistryEntry {
  id: string;
  provider: string;
  mode: "chat" | "embedding";
}

const registry = llmModels as unknown as {
  models: Record<string, RegistryEntry>;
};

const FLAGSHIP_PATTERN = /^([a-z0-9_-]+)\/([a-z]+)-(\d+)\.(\d+)$/;

const flagshipVersion = (
  model: RegistryEntry,
  provider: string,
  mode: "chat" | "embedding",
): [number, number] | undefined => {
  if (model.provider !== provider || model.mode !== mode) return undefined;
  const match = FLAGSHIP_PATTERN.exec(model.id);
  if (!match) return undefined;
  const [, modelProvider, , major, minor] = match;
  if (modelProvider !== provider) return undefined;
  return [Number(major), Number(minor)];
};

const isNewerVersion = (
  candidate: [number, number],
  best: [number, number],
): boolean =>
  candidate[0] > best[0] ||
  (candidate[0] === best[0] && candidate[1] > best[1]);

export const getLatestFlagshipForProvider = (
  provider: string,
  mode: "chat" | "embedding" = "chat",
): string | undefined => {
  let bestId: string | undefined;
  let bestVersion: [number, number] = [-1, -1];

  for (const model of Object.values(registry.models)) {
    const version = flagshipVersion(model, provider, mode);
    if (!version) continue;
    if (isNewerVersion(version, bestVersion)) {
      bestVersion = version;
      bestId = model.id;
    }
  }

  return bestId;
};

export const getLatestOpenAIChatFlagship = (): string | undefined =>
  getLatestFlagshipForProvider("openai", "chat");
