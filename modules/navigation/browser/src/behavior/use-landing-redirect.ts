import { carryLangyConversation } from "@langwatch/langy-contract";
import { useCallback, useEffect, useRef } from "react";

import { belongsToNoOrganization } from "../model/belongs-to-no-organization.ts";
import { useNavigationHost } from "../model/navigation-host.ts";
import { readLastVisitedProduct } from "../model/product-memory.ts";
import type { ProductId } from "../model/products.ts";
import { resolveLandingDestination } from "../model/resolve-landing-destination.ts";
import { resolveOrglessDestination } from "../model/resolve-orgless-destination.ts";
import { navigationApi } from "./navigation-api.ts";
import { useLlmOpsProjectSlug } from "./use-llm-ops-project-slug.ts";
import { useReachableProducts } from "./use-reachable-products.ts";

/** What the server home resolver answered, flattened for the pickers. */
interface ResolvedHome {
  destination: string | null;
  isOverride: boolean;
  isIntentPinned: boolean;
  governanceUiEnabled: boolean;
  isReady: boolean;
  hasError: boolean;
}

/**
 * The home-resolver query, flattened so the pickers read plain values: the
 * procedure sets every field once it answers, so `isReady` means resolved,
 * never "resolved to nothing".
 */
function toResolvedHome(query: {
  data:
    | {
        destination: string;
        isOverride: boolean;
        intentPinned: boolean;
        governanceUiEnabled: boolean;
      }
    | undefined;
  isError: boolean;
}): ResolvedHome {
  return {
    destination: query.data?.destination ?? null,
    isOverride: query.data?.isOverride ?? false,
    isIntentPinned: query.data?.intentPinned ?? false,
    governanceUiEnabled: query.data?.governanceUiEnabled ?? false,
    isReady: query.data !== undefined,
    hasError: query.isError,
  };
}

interface LandingInput {
  resolved: ResolvedHome;
  isReachableLoading: boolean;
  reachableProducts: ProductId[];
  rememberedProduct: ProductId | null;
  /** The last-visited project, personal workspaces included. */
  projectSlug: string | null;
  /**
   * The same project, minus personal workspaces, which are never a
   * project-home target (ADR-038 v6). Without that exclusion the
   * last-visited substitution could land on a personal workspace.
   */
  projectHomeSlug: string | null;
  isOrgless: boolean;
  /** Whether a reader with no organization is an administrator back from an SSO test sign-in. */
  testArrival: { isPending: boolean; isTestArrival: boolean };
}

/**
 * Where `/` goes: per-organization product memory outranks the server
 * resolver (the deliberate ADR-038 deviation), falling through to the
 * safety nets. Null means nothing has an answer yet — stay on loading.
 */
function landingDestination(input: LandingInput): string | null {
  return productLandingDestination(input) ?? fallbackDestination(input);
}

function productLandingDestination({
  resolved,
  isReachableLoading,
  reachableProducts,
  rememberedProduct,
  projectHomeSlug,
}: LandingInput): string | null {
  if (!resolved.isReady || isReachableLoading) return null;
  return resolveLandingDestination({
    pinnedPath: resolved.isOverride ? resolved.destination : null,
    rememberedProduct,
    reachableProducts,
    serverHomeDestination: resolved.destination,
    projectSlug: projectHomeSlug,
  });
}

/** Fallbacks: project home on error; an orgless reader per `resolveOrglessDestination`. */
function fallbackDestination({
  resolved,
  projectSlug,
  isOrgless,
  testArrival,
}: LandingInput): string | null {
  if (resolved.hasError && projectSlug) return `/${projectSlug}`;
  if (!isOrgless) return null;
  return resolveOrglessDestination(testArrival);
}

/** Navigates to destination at most once; prevents update-depth loops from lazy-loading routes */
function useReplaceOnce(): (destination: string | null) => void {
  const host = useNavigationHost();
  const lastReplacedRef = useRef<string | null>(null);

  return useCallback(
    (destination: string | null) => {
      if (destination === null) return;
      if (lastReplacedRef.current === destination) return;
      lastReplacedRef.current = destination;
      host.replace(destination);
    },
    [host],
  );
}

/** The / redirect: picks home per user persona; falls back to project home on error */
/** No destination yet means no redirect yet; a resolved one keeps the conversation parameter. */
function carryIfResolved({
  destination,
  search,
}: {
  destination: string | null;
  search: string;
}): string | null {
  return destination === null ? null : carryLangyConversation({ destination, search });
}

export function useLandingRedirect(): void {
  const host = useNavigationHost();
  const project = host.project();
  const organization = host.organization();
  const organizations = host.organizations();
  const isLoading = host.isLoading();
  const resolved = navigationApi.governance.resolveHome.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization?.id, staleTime: 60_000, retry: false },
  );
  const { reachableProducts, isLoading: isReachableLoading } = useReachableProducts({
    enabled: true,
  });
  const llmOpsProjectSlug = useLlmOpsProjectSlug();
  const replaceOnce = useReplaceOnce();
  const isOrgless = belongsToNoOrganization({
    isWorkspaceResolving: isLoading,
    organization,
    organizations,
  });
  // Asked only of the people it can be true of: everybody with an organization is past this branch.
  const testArrival = navigationApi.identity.myTestArrival.useQuery(
    {},
    { enabled: isOrgless, staleTime: 60_000, retry: false },
  );

  useEffect(() => {
    replaceOnce(
      // `/` is the only link the Langy command line can build, because it knows
      // the conversation and not the project the reader lands in. This redirect
      // drops the query string, so the one parameter that names a conversation
      // travels with it.
      carryIfResolved({
        destination: landingDestination({
          resolved: toResolvedHome({ data: resolved.data, isError: resolved.isError }),
          isReachableLoading,
          reachableProducts,
          rememberedProduct: organization
            ? readLastVisitedProduct({ organizationId: organization.id })
            : null,
          projectSlug: project?.slug ?? null,
          projectHomeSlug: llmOpsProjectSlug,
          isOrgless,
          testArrival: {
            // A failed read falls through to the bootstrap screen rather than holding the redirect.
            isPending: isOrgless && testArrival.isLoading,
            isTestArrival: testArrival.data?.testing === true,
          },
        }),
        search: window.location.search,
      }),
    );
  }, [
    resolved.data,
    resolved.isError,
    project,
    organization,
    organizations,
    isLoading,
    isOrgless,
    testArrival.data,
    testArrival.isLoading,
    replaceOnce,
    isReachableLoading,
    reachableProducts,
    llmOpsProjectSlug,
  ]);
}
