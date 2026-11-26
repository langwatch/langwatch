import { customModelEntrySchema, type Model } from "@langwatch/model-provider-contract";

/**
 * A customer's custom model list, in whichever shape they sent it. An entry's max tokens,
 * parameters and inputs ride along when they are well formed, so a save never drops them.
 */
export function toCanonicalCustomModelList(
  value: unknown,
  type: "chat" | "embedding",
): Model[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((model): Model[] => {
    if (typeof model === "string") return [{ id: model, label: model, type }];
    if (!model || typeof model !== "object") return [];
    const item = model as { modelId?: unknown; displayName?: unknown };
    if (typeof item.modelId !== "string") return [];

    const canonical: Model = {
      id: item.modelId,
      label: typeof item.displayName === "string" ? item.displayName : item.modelId,
      type,
    };
    const full = customModelEntrySchema.safeParse({ ...model, mode: type });
    if (!full.success) return [canonical];
    const { maxTokens, supportedParameters, multimodalInputs } = full.data;
    return [
      {
        ...canonical,
        ...(maxTokens != null && { maxTokens }),
        ...(supportedParameters && { supportedParameters }),
        ...(multimodalInputs && { multimodalInputs }),
      },
    ];
  });
}
