/**
 * A customer's custom model list, in whichever shape they sent it.
 *
 * The field has carried two shapes over its life: a plain array of model id
 * strings, and an array of `{ modelId, displayName }` objects. Both are still
 * accepted, and both surfaces that accept them — the REST write and the tRPC
 * write — have to read them the same way, or the same request lands
 * differently depending on which door it came through.
 *
 * Anything unreadable is DROPPED rather than refused. A custom model list is
 * a convenience field on an otherwise valid provider write, and failing the
 * whole write because one entry is malformed would block a change the customer
 * did mean to make.
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
