/**
 * A customer's custom model list, in whichever shape they sent it.
 */
export class CustomModelList {
  static toCanonical(
    value: unknown,
    type: "chat" | "embedding",
  ): Array<{ id: string; label: string; type: "chat" | "embedding" }> | undefined {
    if (!Array.isArray(value)) return undefined;

    return value.flatMap((model) => {
      if (typeof model === "string") return [{ id: model, label: model, type }];
      if (!model || typeof model !== "object") return [];
      const item = model as { modelId?: unknown; displayName?: unknown };

      return typeof item.modelId === "string"
        ? [
            {
              id: item.modelId,
              label: typeof item.displayName === "string" ? item.displayName : item.modelId,
              type,
            },
          ]
        : [];
    });
  }
}
