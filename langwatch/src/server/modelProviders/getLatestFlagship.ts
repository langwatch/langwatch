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

const registry = llmModels as unknown as { models: Record<string, RegistryEntry> };

const FLAGSHIP_PATTERN = /^([a-z0-9_-]+)\/([a-z]+)-(\d+)\.(\d+)$/;

export const getLatestFlagshipForProvider = (
  provider: string,
  mode: "chat" | "embedding" = "chat",
): string | undefined => {
  let bestId: string | undefined;
  let bestVersion: [number, number] = [-1, -1];

  for (const model of Object.values(registry.models)) {
    if (model.provider !== provider || model.mode !== mode) continue;
    const match = FLAGSHIP_PATTERN.exec(model.id);
    if (!match) continue;
    const [, modelProvider, , major, minor] = match;
    if (modelProvider !== provider) continue;
    const v: [number, number] = [Number(major), Number(minor)];
    if (
      v[0] > bestVersion[0] ||
      (v[0] === bestVersion[0] && v[1] > bestVersion[1])
    ) {
      bestVersion = v;
      bestId = model.id;
    }
  }

  return bestId;
};

export const getLatestOpenAIChatFlagship = (): string | undefined =>
  getLatestFlagshipForProvider("openai", "chat");
