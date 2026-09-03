import { LANGY_CHAT_FEATURE_KEY } from "@langwatch/model-provider-contract";
import type { api } from "../../../../behavior/langy-api";
import { useLangyStore } from "../../../../index";

type ApiUtils = ReturnType<typeof api.useUtils>;

/**
 * Client-side follow-up to a server-side default-model write (a codex connect
 * with defaults, or the settings drawer saving the Default Models config).
 * The server already moved the role defaults; this makes the open UI agree
 * with it without a reload:
 *
 * 1. Remember what Langy's feature key resolved to BEFORE the write (from
 *    the query cache, so no extra request), as the fallback for a resolver
 *    re-read that fails.
 * 2. Invalidate the modelProvider caches (resolved defaults, the Default
 *    Models table, provider lists) so every mounted consumer refetches.
 * 3. Ask the resolver what the key resolves to NOW and hand the change to
 *    the langy store, which snaps the pill to it only while the pill still
 *    holds a seeded value (see followCodingDefaultChange).
 *
 * `fallbackModel` is what the pill follows when the resolver re-read fails —
 * the codex flow passes the codex model it just wrote (still the right thing
 * to show). Without one, a failed re-read follows the previous default, which
 * makes the follow a no-op rather than a guess.
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
