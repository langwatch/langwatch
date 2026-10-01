// biome-ignore-all lint/suspicious/noEmptyBlockStatements: empty blocks here are deliberate no-ops.

import type { api } from "./model-provider-api.ts";

/**
 * BroadcastChannel name for cross-tab model-provider sync: NoModelsConfiguredCallout opens
 * settings in its own tab (its own QueryClient), so a save there reaches other open tabs only
 * via this channel, not `refetchOnWindowFocus` alone, which previously left pickers stuck (#5827).
 */
const MODEL_PROVIDER_SYNC_CHANNEL = "langwatch:model-providers-updated" as const;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  try {
    return new BroadcastChannel(MODEL_PROVIDER_SYNC_CHANNEL);
  } catch {
    // Some browsers throw (e.g. SecurityError) in restricted contexts —
    // opaque-origin iframes, strict privacy modes. This runs on a
    // mutation's success path, so degrade to null (falls back to focus
    // refetch) rather than let it surface as a save-failed toast.
    return null;
  }
}

/** Call once a model-provider create/update/enable mutation has succeeded
 *  (and this tab's own queries are already invalidated) so every other open
 *  tab picks up the change too. No-ops in SSR or browsers without
 *  BroadcastChannel — those still fall back to focus refetch. */
export function broadcastModelProvidersUpdated() {
  const channel = getChannel();
  if (!channel) return;
  channel.postMessage({ type: "model-providers-updated" });
  channel.close();
}

/** Subscribes `onUpdate` to saves broadcast by other tabs. Returns a cleanup
 *  function (or a no-op where BroadcastChannel isn't available) — call from
 *  a `useEffect`. */
export function subscribeToModelProvidersUpdated(onUpdate: () => void): () => void {
  const channel = getChannel();
  if (!channel) return () => {};
  channel.onmessage = onUpdate;
  return () => channel.close();
}

type ModelProviderUtils = Pick<ReturnType<typeof api.useUtils>, "modelProvider">;

/** Every tRPC query surface whose freshness depends on the stored
 *  ModelProvider/ModelDefault rows. Shared by the same-tab mutation success
 *  path (useProviderFormSubmit) and the cross-tab listener
 *  (ModelProviderCrossTabSync in api.tsx) so the two invalidation lists
 *  can never drift apart. */
export function invalidateModelProviderQueries(utils: ModelProviderUtils) {
  return Promise.all([
    utils.modelProvider.getAllForProject.invalidate(),
    utils.modelProvider.getAllForProjectForFrontend.invalidate(),
    utils.modelProvider.listAllForProjectForFrontend.invalidate(),
    utils.modelProvider.listAllForOrganizationForFrontend.invalidate(),
    utils.modelProvider.getResolvedDefault.invalidate(),
    utils.modelProvider.getDefaultModelsForProject.invalidate(),
  ]);
}
