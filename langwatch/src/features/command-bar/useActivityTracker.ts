import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRecentItems } from "./useRecentItems";
import type { RecentItemType } from "./types";

/**
 * Entity type detection from URL patterns.
 */
interface EntityMatch {
  type: RecentItemType;
  id: string;
  iconName: string;
  typeLabel: string;
}

/**
 * Parse a URL path to extract entity information.
 * Returns null if the path doesn't match a known entity pattern.
 */
function parseEntityUrl(path: string, projectSlug: string): EntityMatch | null {
  // Remove query params and hash
  const cleanPath = path.split("?")[0]?.split("#")[0] ?? "";
  const prefix = `/${projectSlug}`;

  if (!cleanPath.startsWith(prefix)) {
    return null;
  }

  const relativePath = cleanPath.slice(prefix.length);

  // Trace page: /[project]/messages/[traceId]
  const traceMatch = relativePath.match(/^\/messages\/([^/]+)$/);
  if (traceMatch) {
    return {
      type: "trace",
      id: traceMatch[1]!,
      iconName: "traces",
      typeLabel: "Trace",
    };
  }

  // Span page: /[project]/messages/[traceId]/[tab]/[spanId]
  const spanMatch = relativePath.match(/^\/messages\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (spanMatch) {
    return {
      type: "span",
      id: spanMatch[3]!,
      iconName: "traces",
      typeLabel: "Span",
    };
  }

  // Prompt page: /[project]/prompts with query param handle
  // This requires special handling with query params
  // We handle this separately when we have access to full URL

  // Agent page: /[project]/agents with drawer open
  // We handle this separately when we have access to full URL

  // Workflow page: /[project]/workflows/[slug]
  const workflowMatch = relativePath.match(/^\/workflows\/([^/]+)$/);
  if (workflowMatch) {
    return {
      type: "entity",
      id: workflowMatch[1]!,
      iconName: "workflow",
      typeLabel: "Workflow",
    };
  }

  // Dataset page: /[project]/datasets/[id]
  const datasetMatch = relativePath.match(/^\/datasets\/([^/]+)$/);
  if (datasetMatch) {
    return {
      type: "entity",
      id: datasetMatch[1]!,
      iconName: "dataset",
      typeLabel: "Dataset",
    };
  }

  // Evaluator page: /[project]/evaluators with drawer open
  // We handle this separately when we have access to full URL

  // Simulation run: /[project]/simulations/[scenarioSetId]/[batchRunId]/[scenarioRunId]
  const simRunMatch = relativePath.match(
    /^\/simulations\/([^/]+)\/([^/]+)\/([^/]+)$/
  );
  if (simRunMatch) {
    return {
      type: "simulation-run",
      id: simRunMatch[3]!,
      iconName: "simulations",
      typeLabel: "Simulation",
    };
  }

  return null;
}

/**
 * Parse drawer-based entity access from URL query params.
 */
function parseDrawerEntity(
  fullUrl: string,
  projectSlug: string
): EntityMatch | null {
  try {
    const url = new URL(fullUrl, "http://localhost");
    const drawerOpen = url.searchParams.get("drawer.open");
    const prefix = `/${projectSlug}`;

    if (!url.pathname.startsWith(prefix)) {
      return null;
    }

    // Agent viewer drawer
    if (drawerOpen === "agentViewer") {
      const agentId = url.searchParams.get("drawer.agentId");
      if (agentId) {
        return {
          type: "entity",
          id: agentId,
          iconName: "agent",
          typeLabel: "Agent",
        };
      }
    }

    // Evaluator viewer drawer
    if (drawerOpen === "evaluatorViewer") {
      const evaluatorId = url.searchParams.get("drawer.evaluatorId");
      if (evaluatorId) {
        return {
          type: "entity",
          id: evaluatorId,
          iconName: "evaluator",
          typeLabel: "Evaluator",
        };
      }
    }

    // Prompt page with handle param
    const handle = url.searchParams.get("handle");
    if (url.pathname === `${prefix}/prompts` && handle) {
      return {
        type: "entity",
        id: handle,
        iconName: "prompt",
        typeLabel: "Prompt",
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Hook that tracks user navigation to entity pages automatically.
 * Uses Next.js router events to detect navigation and adds items to recent history.
 */
export function useActivityTracker() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { addRecentItem } = useRecentItems();

  // Track last added item to prevent duplicates
  const lastAddedRef = useRef<string | null>(null);

  const trackRouteChange = useCallback(
    (url: string) => {
      if (!project?.slug) return;

      // Try path-based entity detection
      let entityMatch = parseEntityUrl(url, project.slug);

      // Try drawer-based entity detection if no path match
      if (!entityMatch) {
        entityMatch = parseDrawerEntity(url, project.slug);
      }

      if (!entityMatch) return;

      // Prevent adding the same item twice in quick succession
      const itemKey = `${entityMatch.type}-${entityMatch.id}`;
      if (lastAddedRef.current === itemKey) return;
      lastAddedRef.current = itemKey;

      // Generate label based on entity type
      let label = entityMatch.id;
      if (entityMatch.type === "trace") {
        // Truncate trace IDs for display
        label = entityMatch.id.length > 20
          ? `${entityMatch.id.slice(0, 20)}...`
          : entityMatch.id;
      }

      addRecentItem({
        id: itemKey,
        type: entityMatch.type,
        label,
        description: entityMatch.typeLabel,
        path: url.startsWith("/") ? url : `/${url}`,
        iconName: entityMatch.iconName,
        projectSlug: project.slug,
      });
    },
    [project?.slug, addRecentItem]
  );

  useEffect(() => {
    // Track initial page load
    if (router.isReady && project?.slug) {
      trackRouteChange(router.asPath);
    }

    // Track subsequent navigation
    const handleRouteChange = (url: string) => {
      trackRouteChange(url);
    };

    router.events.on("routeChangeComplete", handleRouteChange);
    return () => {
      router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, [router, project?.slug, trackRouteChange]);
}
