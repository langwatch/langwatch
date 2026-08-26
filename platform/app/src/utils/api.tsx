/**
 * This is the client-side entrypoint for your tRPC API. It is used to create the `api` object which
 * contains your type-safe React Query hooks.
 *
 * We also create a few inference helpers for input and output types.
 */

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { type ReactNode, useEffect, useState } from "react";
import type { AppRouter } from "~/server/api/root";
import {
  showAiCallFailedToast,
  showMissingModelToast,
  showProviderDisabledToast,
} from "../components/MissingModelToast";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";
import {
  invalidateModelProviderQueries,
  subscribeToModelProvidersUpdated,
} from "./modelProviderSync";
import { shouldRetryQuery } from "./queryRetryPolicy";
import { createTRPCLinks } from "./trpc-transport";
import {
  extractAiCallFailedInfo,
  extractLimitExceededInfo,
  extractLiteMemberRestrictionInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
  markAsHandledByLicenseHandler,
  markAsHandledByLiteMemberHandler,
  markAsHandledByMissingModelHandler,
  markAsHandledByProviderDisabledHandler,
} from "./trpcError";
import { WorkflowApiProvider } from "./workflow-api";

/**
 * Returns the `onSwapToAlternate` callback the provider-disabled toast
 * needs — but only when the swap is actually performable from this
 * client:
 *   1. The disabled scope is "project" — clearing team/org defaults
 *      requires team/org-level permission this user may not have.
 *   2. The cascade has an alternate, and that alternate's provider is
 *      currently enabled, so the swap actually unblocks the feature
 *      instead of trading one disabled provider for another.
 *
 * When either check fails, returns `undefined` so the toast falls back
 * to its "Open settings" deep-link variant — still actionable, just not
 * one-click.
 *
 * The toast doesn't cache the AI failure, so we don't need to manually
 * invalidate after swapping — the user's next AI action re-resolves
 * the cascade and picks the now-reachable alternate.
 */
function providerDisabledSwapHandler(
  info: ReturnType<typeof extractProviderDisabledInfo>,
): (() => Promise<void>) | undefined {
  if (!info) return undefined;
  if (info.resolvedScope !== "project") return undefined;
  if (!info.alternate?.providerEnabled) return undefined;
  return async () => {
    await trpcClient.modelProvider.setFeatureOverrideForScope.mutate({
      scopeType: "PROJECT",
      scopeId: info.projectId,
      featureKey: info.featureKey,
      model: null,
    });
  };
}

function createQueryClientConfig() {
  return {
    /**
     * Global mutation error handler for license limit enforcement.
     *
     * This handler intercepts all tRPC mutation errors and:
     * 1. Checks if the error is a LIMIT_EXCEEDED FORBIDDEN error
     * 2. If so, opens the upgrade modal with limit details
     * 3. Marks the error via WeakSet so component-level handlers can skip it
     *
     * Components using `onError` callbacks should check `isHandledByGlobalLicenseHandler(error)`
     * to avoid showing duplicate error UI (toast + modal) for license errors.
     *
     * @see isHandledByGlobalLicenseHandler in trpcError.ts
     * @see extractLimitExceededInfo in trpcError.ts
     */
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, _mutation) => {
        const limitInfo = extractLimitExceededInfo(error);
        if (limitInfo) {
          // Mark as handled so component-level handlers can skip it
          if (error instanceof Error) {
            markAsHandledByLicenseHandler(error);
          }

          useUpgradeModalStore
            .getState()
            .open(limitInfo.limitType, limitInfo.current, limitInfo.max);
        }
        // Check for lite member restriction errors
        const restrictionInfo = extractLiteMemberRestrictionInfo(error);
        if (restrictionInfo) {
          if (error instanceof Error) {
            markAsHandledByLiteMemberHandler(error);
          }
          useUpgradeModalStore.getState().openLiteMemberRestriction({
            resource: restrictionInfo.resource,
          });
        }
        // Check for ModelNotConfiguredError — surfaced when an AI-powered
        // feature can't resolve a model anywhere in the scope chain.
        // Emits a sticky orange toast (deduped per (featureKey, role)
        // toast id) instead of a focus-trapping modal: explicit user
        // actions still get a clear, actionable nudge but background
        // flows (auto-save, prefetch) don't get blocked behind a Dialog.
        const missingModelInfo = extractMissingModelInfo(error);
        if (missingModelInfo) {
          if (error instanceof Error) {
            markAsHandledByMissingModelHandler(error);
          }
          showMissingModelToast(missingModelInfo);
        }
        // A successful resolve that still produced a provider error
        // (bad key, 5xx, timed-out) arrives without MODEL_NOT_CONFIGURED
        // but with an AI_CALL_FAILED discriminator. Surface a softer
        // toast nudging the user to verify their model configuration —
        // most provider errors at this layer trace back to a misset key
        // or a wrong model id.
        const aiFailedInfo = extractAiCallFailedInfo(error);
        if (aiFailedInfo) {
          showAiCallFailedToast(aiFailedInfo);
        }
        // Cascade DID resolve, but the chosen model's provider is
        // disabled. Open a toast offering a one-click swap to the
        // parent-scope default (when there is one) — the swap calls
        // back into modelProviders.setFeatureOverrideForScope to clear
        // the disabled-scope key so the next resolve falls through.
        const providerDisabledInfo = extractProviderDisabledInfo(error);
        if (providerDisabledInfo) {
          if (error instanceof Error) {
            markAsHandledByProviderDisabledHandler(error);
          }
          showProviderDisabledToast({
            ...providerDisabledInfo,
            onSwapToAlternate: providerDisabledSwapHandler(providerDisabledInfo),
          });
        }
        // Non-license/non-restriction errors bubble up to component-level handlers
      },
    }),
    queryCache: new QueryCache({
      onError: (error) => {
        // Silently mark lite member restriction errors on queries.
        // Queries may fail on allowed pages (e.g., cost:view on analytics)
        // — the component handles missing data gracefully.
        // Only mutations and route guards should trigger the modal.
        const restrictionInfo = extractLiteMemberRestrictionInfo(error);
        if (restrictionInfo && error instanceof Error) {
          markAsHandledByLiteMemberHandler(error);
        }
        // Queries (e.g. fetching a result that requires an LLM call
        // server-side) can also surface a ModelNotConfiguredError. Same
        // toast surface as the mutation path.
        const missingModelInfo = extractMissingModelInfo(error);
        if (missingModelInfo) {
          if (error instanceof Error) {
            markAsHandledByMissingModelHandler(error);
          }
          showMissingModelToast(missingModelInfo);
        }
        const aiFailedInfo = extractAiCallFailedInfo(error);
        if (aiFailedInfo) {
          showAiCallFailedToast(aiFailedInfo);
        }
        const providerDisabledInfo = extractProviderDisabledInfo(error);
        if (providerDisabledInfo) {
          if (error instanceof Error) {
            markAsHandledByProviderDisabledHandler(error);
          }
          showProviderDisabledToast({
            ...providerDisabledInfo,
            onSwapToAlternate: providerDisabledSwapHandler(providerDisabledInfo),
          });
        }
      },
    }),
    defaultOptions: {
      mutations: {
        networkMode: "always" as const,
      },
      queries: {
        // Keep navigation/focus from replaying every active tRPC query. Pages
        // opt into focus refresh explicitly when they show live operational
        // state; ordinary project metadata and analytics stay warm for 30s.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        networkMode:
          process.env.NODE_ENV !== "production"
            ? ("always" as const)
            : ("online" as const),
        retry: shouldRetryQuery,
      },
    },
  };
}

/** A set of type-safe react-query hooks for your tRPC API. */
export const api = createTRPCReact<AppRouter>();

/** Vanilla tRPC client for use outside of React components. */
export const trpcClient = createTRPCClient<AppRouter>({
  links: createTRPCLinks(),
});

/**
 * Mounted once inside the provider tree. Listens for model-provider saves
 * broadcast by OTHER tabs (see modelProviderSync.ts — a tab opened via
 * `window.open`, e.g. from NoModelsConfiguredCallout, has its own
 * QueryClient and can't reach this one directly) and invalidates this
 * tab's cache immediately, rather than waiting on a window-focus event.
 */
function ModelProviderCrossTabSync() {
  const utils = api.useUtils();

  useEffect(
    () =>
      subscribeToModelProvidersUpdated(() => {
        void invalidateModelProviderQueries(utils);
      }),
    [utils],
  );

  return null;
}

/**
 * TRPCProvider component that replaces the old api.withTRPC() HOC from @trpc/next.
 * Provides QueryClient and tRPC client to the React tree.
 */
export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient(createQueryClientConfig()));
  const [trpcClientInstance] = useState(() =>
    api.createClient({
      links: createTRPCLinks(),
    }),
  );

  return (
    <api.Provider client={trpcClientInstance} queryClient={queryClient}>
      <WorkflowApiProvider queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ModelProviderCrossTabSync />
          {children}
        </QueryClientProvider>
      </WorkflowApiProvider>
    </api.Provider>
  );
}

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
