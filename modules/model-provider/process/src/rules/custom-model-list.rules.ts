import {
  multimodalInputValues,
  supportedParameterValues,
  type Model,
} from "@langwatch/model-provider-contract";
import { z } from "zod";

type CanonicalCustomModel = Model & { type: "chat" | "embedding" };

/** The per-model settings the custom-model form collects; a malformed one is dropped. */
const settingSchemas = {
  maxTokens: z.number().positive().nullable(),
  supportedParameters: z.array(z.enum(supportedParameterValues)),
  multimodalInputs: z.array(z.enum(multimodalInputValues)),
} as const;

/**
 * A customer's custom model list, in whichever shape they sent it.
 */
export function toCanonicalCustomModelList(
  value: unknown,
  type: "chat" | "embedding",
): CanonicalCustomModel[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((model): CanonicalCustomModel[] => {
    if (typeof model === "string") return [{ id: model, label: model, type }];
    if (!model || typeof model !== "object") return [];
    const item = model as Record<string, unknown>;
    if (typeof item.modelId !== "string") return [];

    return [
      {
        id: item.modelId,
        label: typeof item.displayName === "string" ? item.displayName : item.modelId,
        type,
        ...settingsOf(item),
      },
    ];
  });
}

function settingsOf(
  item: Record<string, unknown>,
): Pick<Model, "maxTokens" | "supportedParameters" | "multimodalInputs"> {
  const maxTokens = settingSchemas.maxTokens.safeParse(item.maxTokens);
  const supportedParameters = settingSchemas.supportedParameters.safeParse(
    item.supportedParameters,
  );
  const multimodalInputs = settingSchemas.multimodalInputs.safeParse(item.multimodalInputs);

  return {
    ...(maxTokens.success ? { maxTokens: maxTokens.data } : {}),
    ...(supportedParameters.success ? { supportedParameters: supportedParameters.data } : {}),
    ...(multimodalInputs.success ? { multimodalInputs: multimodalInputs.data } : {}),
  };
}
