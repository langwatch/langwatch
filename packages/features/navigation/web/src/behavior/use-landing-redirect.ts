import { useCallback, useEffect, useRef } from "react";
import { useNavigationHost } from "../model/navigation-host";
import { readLastVisitedProduct } from "../model/product-memory";
import {
  type LastVisitedHomeKind,
  resolveHomeDestination,
} from "../model/resolve-home-destination";
import { resolveLandingDestination } from "../model/resolve-landing-destination";
import type { ProductId } from "../model/products";
import { navigationApi } from "./navigation-api";
import { useLlmOpsProjectSlug } from "./use-llm-ops-project-slug";
import { useNavigationMode } from "./use-navigation-mode";
import { useReachableProducts } from "./use-reachable-products";

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
  isV2: boolean;
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
  lastVisitedHomeKind: LastVisitedHomeKind;
}

/**
 * Where `/` goes. In a new navigation mode the per-organization product
 * memory outranks the server resolver, which is the deliberate ADR-038
 * deviation; legacy mode keeps the persona resolver. Both fall through to
 * the same safety nets. Null means nothing has an answer yet, so the page
 * stays on the loading screen.
 */
function landingDestination(input: LandingInput): string | null {
  const picked = input.isV2
    ? productLandingDestination(input)
    : personaHomeDestination(input);
  return picked ?? fallbackDestination(input);
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

/**
 * The persona resolver picks the DEFAULT for a user with no history. On
 * top of that we honor the last-visited home so it sticks both ways: a
 * user whose persona default is /me still returns to the project they
 * last opened, and /me sticks for someone who last sat there. An explicit
 * picker pin (isOverride) always wins.
 */
function personaHomeDestination({
  resolved,
  lastVisitedHomeKind,
  projectHomeSlug,
}: LandingInput): string | null {
  if (!resolved.destination) return null;
  return resolveHomeDestination({
    resolverDestination: resolved.destination,
    isOverride: resolved.isOverride,
    intentPinned: resolved.isIntentPinned,
    governanceUiEnabled: resolved.governanceUiEnabled,
    lastVisitedHomeKind,
    lastProjectSlug: projectHomeSlug,
  });
}

/**
 * The safety nets, shared by both modes. A failed resolver keeps the
 * LLMOps majority on their project home, so a transient backend error
 * never strands them.
 *
 * A user with no organization goes to the bootstrap page. Routing them to
 * /me instead is a dead end for a fresh-signup admin: no projects, no
 * discoverable path onward, and /governance renders Access Restricted
 * behind the governance:view gate. /onboarding/welcome creates the
 * organization and the first project (api.onboarding.initializeOrganization),
 * after which the resolver picks the right destination on the next visit.
 */
function fallbackDestination({
  resolved,
  projectSlug,
  isOrgless,
}: LandingInput): string | null {
  if (resolved.hasError && projectSlug) return `/${projectSlug}`;
  if (isOrgless) return "/onboarding/welcome";
  return null;
}

/**
 * Navigate to a destination at most once.
 *
 * Several of the redirect effect's dependencies get a fresh identity per
 * render while the target route lazy-loads, so the effect re-runs during
 * the navigation. Repeating router.replace with the same target
 * interrupts and restarts that navigation, which React reports as an
 * update-depth loop. A changed destination still goes through.
 */
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

/**
 * The `/` redirect: picks the right home for the user's persona via the
 * `api.governance.resolveHome` tRPC procedure. Falls back to the existing
 * project-default redirect if the resolver query is still loading or
 * fails, so the LLMOps majority experience never regresses on transient
 * backend errors.
 *
 * Specs: specs/ai-gateway/governance/persona-home-resolver.feature
 *        specs/navigation/navigation-v2-landing.feature
 */
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
  // Implicit home-kind preference written by the application on each visit.
  // Honored only when the user has no explicit pin via the picker, so /me AND
  // the last-visited project both stick, without overriding the user's
  // deliberate choice.
  const lastVisitedHomeKind: LastVisitedHomeKind = host.lastVisitedHomeKind();
  const navigationResolution = useNavigationMode();
  const isV2 =
    navigationResolution.status === "ready" && navigationResolution.mode !== "legacy";
  // Legacy mode never reads the product list, and must not pay for the
  // flag queries behind it.
  const { reachableProducts, isLoading: isReachableLoading } = useReachableProducts({
    enabled: isV2,
  });
  const llmOpsProjectSlug = useLlmOpsProjectSlug();
  const replaceOnce = useReplaceOnce();

  useEffect(() => {
    if (navigationResolution.status === "loading") return;
    replaceOnce(
      landingDestination({
        isV2,
        resolved: toResolvedHome(resolved),
        isReachableLoading,
        reachableProducts,
        rememberedProduct: organization
          ? readLastVisitedProduct({ organizationId: organization.id })
          : null,
        projectSlug: project?.slug ?? null,
        projectHomeSlug: llmOpsProjectSlug,
        isOrgless: !isLoading && !organization && organizations.length === 0,
        lastVisitedHomeKind,
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
    lastVisitedHomeKind,
    navigationResolution.status,
    isV2,
    isReachableLoading,
    reachableProducts,
    llmOpsProjectSlug,
  ]);
}
