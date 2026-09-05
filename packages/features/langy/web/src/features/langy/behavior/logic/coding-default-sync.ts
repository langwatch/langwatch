import { LANGY_CHAT_FEATURE_KEY } from "@langwatch/model-provider-contract";
import type { api } from "../../../../behavior/langy-api";
import { useLangyStore } from "../../../../index";

type ApiUtils = ReturnType<typeof api.useUtils>;

/**
 * Client-side follow-up to a server-side default-model write (a codex connect with
 * defaults, or the settings drawer saving the Default Models config).
 */
export async function syncLangyAfterDefaultModelWrite({
  utils,
  projectId,
  fallbackModel,
}: {
  utils: ApiUtils;
  projectId: string;
  fallbackModel?: string;
}): Promise<void> {
  const resolvedInput = { projectId, featureKey: LANGY_CHAT_FEATURE_KEY };

  // The role defaults are already written server-side; the cache read, the
  // invalidate and the resolver re-read only bring the open UI along. None of
  // them may surface to the caller as the write failing, so the whole
  // query-client interaction is contained here and the store call below runs
  // on whatever it produced.
  let previousDefault: string | null = null;
  let nextDefault: string | null | undefined;
  try {
    previousDefault = utils.modelProvider.getResolvedDefault.getData(resolvedInput)?.model ?? null;
    await utils.modelProvider.invalidate();
    const resolved = await utils.modelProvider.getResolvedDefault.fetch(resolvedInput);
    nextDefault = resolved?.model ?? fallbackModel ?? previousDefault;
  } catch {
    nextDefault = fallbackModel ?? previousDefault;
  }
  if (!nextDefault) return;

  useLangyStore.getState().followCodingDefaultChange({ nextDefault });
}
