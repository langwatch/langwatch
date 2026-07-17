import type { api } from "./api";

/**
 * BroadcastChannel name for cross-tab model-provider sync.
 *
 * NoModelsConfiguredCallout opens /settings/model-providers via
 * `window.open(..., "_blank")` rather than an in-app navigation, so the
 * settings page runs in its own tab with its own QueryClient instance.
 * Saving a provider there invalidates that tab's cache just fine, but the
 * ORIGINAL tab (e.g. a still-open "New Prompt" dialog) has no route back to
 * that cache and previously depended on `refetchOnWindowFocus` alone to
 * notice — which doesn't fire until the user manually refocuses the
 * original tab, and in practice left the picker stuck empty until a hard
 * refresh (#5827). Posting here on save lets every other open tab
 * invalidate immediately, focus or no focus.
 */
const MODEL_PROVIDER_SYNC_CHANNEL = "langwatch:model-providers-updated";

function getChannel(): BroadcastChannel | null {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return null;
  }
  return new BroadcastChannel(MODEL_PROVIDER_SYNC_CHANNEL);
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
export function subscribeToModelProvidersUpdated(
  onUpdate: () => void,
): () => void {
  const channel = getChannel();
  if (!channel) return () => {};
  channel.onmessage = onUpdate;
  return () => channel.close();
}

type ModelProviderUtils = Pick<
  ReturnType<typeof api.useContext>,
  "modelProvider"
>;

/** Every tRPC query surface whose freshness depends on the stored
 *  ModelProvider/ModelDefault rows. Shared by the same-tab mutation success
 *  path (useProviderFormSubmit) and the cross-tab listener
 *  (useModelProviderCrossTabSync) so the two invalidation lists can never
 *  drift apart. */
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
