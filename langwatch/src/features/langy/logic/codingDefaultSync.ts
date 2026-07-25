import {
  CODEX_DEFAULT_MODEL,
  LANGY_CHAT_FEATURE_KEY,
} from "~/server/modelProviders/codexRestrictions";
import type { api } from "~/utils/api";
import { useLangyStore } from "../stores/langyStore";

type ApiUtils = ReturnType<typeof api.useUtils>;

/**
 * Client-side follow-up to a server-side coding-defaults write (a codex
 * connect with defaults, or the settings page's "Set as default" dialog).
 * The server already moved the LANGY and FAST role defaults; this makes the
 * open UI agree with it without a reload:
 *
 * 1. Remember what Langy's feature key resolved to BEFORE the write (from
 *    the query cache, so no extra request): the composer's model pill was
 *    seeded from that value when the panel opened.
 * 2. Invalidate the modelProvider caches (resolved defaults, the Default
 *    Models table, provider lists) so every mounted consumer refetches.
 * 3. Ask the resolver what the key resolves to NOW and hand the change to
 *    the langy store, which snaps the pill to it only when the user never
 *    explicitly picked a different model (see followCodingDefaultChange).
 */
export async function syncLangyAfterCodingDefaultsWrite({
  utils,
  projectId,
}: {
  utils: ApiUtils;
  projectId: string;
}): Promise<void> {
  const resolvedInput = { projectId, featureKey: LANGY_CHAT_FEATURE_KEY };
  const previousDefault =
    utils.modelProvider.getResolvedDefault.getData(resolvedInput)?.model ??
    null;

  // The role defaults are already written server-side; the invalidate and
  // the resolver re-read only bring the open UI along. Neither failure may
  // surface to the caller as the write failing: the written codex model is
  // still the right thing to show.
  const nextDefault = await utils.modelProvider
    .invalidate()
    .then(() => utils.modelProvider.getResolvedDefault.fetch(resolvedInput))
    .then((resolved) => resolved?.model ?? CODEX_DEFAULT_MODEL)
    .catch(() => CODEX_DEFAULT_MODEL);

  useLangyStore
    .getState()
    .followCodingDefaultChange({ previousDefault, nextDefault });
}
