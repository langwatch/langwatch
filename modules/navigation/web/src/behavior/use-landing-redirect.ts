import { useCallback, useEffect, useRef } from "react";
import { carryLangyConversation } from "@langwatch/langy-contract";
import { useNavigationHost } from "../model/navigation-host.ts";
import { readLastVisitedProduct } from "../model/product-memory.ts";
import { resolveLandingDestination } from "../model/resolve-landing-destination.ts";
import type { ProductId } from "../model/products.ts";
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
 * The home-resolver query, flattened so the pickers read plain values.
 *
 * The procedure answers `PersonaResolution` with every field set, so the
 * only absent value is `undefined` while the query is still pending. The
 * parameter says exactly that: an answer means the fields are there, and
 * `isReady` therefore means resolved, never "resolved to nothing".
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
}

/**
 * Where `/` goes. The per-organization product memory outranks the
 * server resolver, which is the deliberate ADR-038 deviation. Falls
 * through to the safety nets. Null means nothing has an answer yet, so
 * the page stays on the loading screen.
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

/** Fallback destinations: project home on error, /onboarding/welcome for orgless users */
function fallbackDestination({ resolved, projectSlug, isOrgless }: LandingInput): string | null {
  if (resolved.hasError && projectSlug) return `/${projectSlug}`;
  if (isOrgless) return "/onboarding/welcome";
  return null;
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

  useEffect(() => {
    replaceOnce(
      // `/` is the only link the Langy command line can build, because it knows
      // the conversation and not the project the reader lands in. This redirect
      // drops the query string, so the one parameter that names a conversation
      // travels with it.
      carryLangyConversation({
        destination: landingDestination({
          resolved: toResolvedHome(resolved),
          isReachableLoading,
          reachableProducts,
          rememberedProduct: organization
            ? readLastVisitedProduct({ organizationId: organization.id })
            : null,
          projectSlug: project?.slug ?? null,
          projectHomeSlug: llmOpsProjectSlug,
          isOrgless:
            !isLoading && !organization && (organizations?.length ?? 0) === 0,
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
    replaceOnce,
    isReachableLoading,
    reachableProducts,
    llmOpsProjectSlug,
  ]);
}
