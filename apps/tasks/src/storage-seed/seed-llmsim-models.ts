import type { CustomModelEntry } from "@langwatch/model-provider-contract";

/** llmsim answers a model named "error-<status>" with that status (`llmsim` skill). */
const LLMSIM_ERROR_MODELS: CustomModelEntry[] = [429, 500].map((status) => ({
  modelId: `error-${status}`,
  displayName: `llmsim error ${status}`,
  mode: "chat",
}));

/** The OpenAI row's custom models when haven routes OpenAI at llmsim (HAVEN_SEED_LLMSIM_MODELS=1). */
export function llmsimCustomModels({
  provider,
  environment,
}: {
  provider: string;
  environment: Readonly<Record<string, string | undefined>>;
}): CustomModelEntry[] | undefined {
  if (provider !== "openai" || environment.HAVEN_SEED_LLMSIM_MODELS !== "1") return undefined;
  return LLMSIM_ERROR_MODELS;
}
