import { useEffect, useRef } from "react";
import { useNavigationHost } from "../model/navigation-host";
import type { RecentItemType } from "../model/command-bar-types";
import { useRecentItems } from "./use-recent-items";

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
 *
 * Exported so its suite reads THIS table rather than a second copy of it. The
 * test that travelled with the hook re-declared the patterns inline and
 * asserted against its own declaration, which is a test that cannot fail on a
 * change to the product.
 */
export function parseEntityUrl(path: string, projectSlug: string): EntityMatch | null {
  // Remove query params and hash
  const cleanPath = path.split("?")[0]?.split("#")[0] ?? "";
  const prefix = `/${projectSlug}`;

  if (!cleanPath.startsWith(prefix)) {
    return null;
  }

  const relativePath = cleanPath.slice(prefix.length);

  // Trace deep link: /[project]/traces/[traceId] (current) or the legacy
  // /[project]/messages/[traceId]
  const traceMatch =
    relativePath.match(/^\/traces\/([^/]+)$/) ??
    relativePath.match(/^\/messages\/([^/]+)$/);
  if (traceMatch) {
    return {
      type: "trace",
      id: traceMatch[1]!,
      iconName: "traces",
      typeLabel: "Trace",
    };
  }

  // Legacy span page: /[project]/messages/[traceId]/[tab]/[spanId]. That path
  // now redirects, but history entries recorded before the redirect landed
  // still name it.
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
  const simRunMatch = relativePath.match(/^\/simulations\/([^/]+)\/([^/]+)\/([^/]+)$/);
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
function parseDrawerEntity(fullUrl: string, projectSlug: string): EntityMatch | null {
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

    // Evaluator editor drawer — the id that actually exists in drawerRegistry.
    // (`evaluatorViewer` was a phantom id: no drawer answered to it, so links
    // carrying it opened nothing and this branch never matched a real visit.)
    if (drawerOpen === "evaluatorEditor") {
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
 * Tracks the entity pages a reader visits, so Quick Search can offer them back.
 *
 * IT WATCHES THE ADDRESS, not a router's event stream. The platform hook it
 * came from subscribed to `routeChangeComplete`, which is one router's own
 * vocabulary; the port answers with the address on screen, and an address that
 * changed IS the navigation that happened. Same recordings, one less thing the
 * package has to know about the application it is mounted in.
 */
export function useActivityTracker() {
  const host = useNavigationHost();
  const project = host.project();
  const projectSlug = project?.slug;
  const url = `${host.pathname()}${host.search()}`;
  const { addRecentItem } = useRecentItems();

  // Track last added item to prevent duplicates
  const lastAddedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectSlug) return;

    // Try path-based entity detection, then the drawer-based one
    const entityMatch =
      parseEntityUrl(url, projectSlug) ?? parseDrawerEntity(url, projectSlug);

    if (!entityMatch) {
      lastAddedRef.current = null; // Clear ref so revisits work
      return;
    }

    // Prevent adding the same item twice in quick succession
    const itemKey = `${entityMatch.type}-${entityMatch.id}`;
    if (lastAddedRef.current === itemKey) return;
    lastAddedRef.current = itemKey;

    // Generate label based on entity type
    let label = entityMatch.id;
    if (entityMatch.type === "trace") {
      // Truncate trace IDs for display
      label =
        entityMatch.id.length > 20 ? `${entityMatch.id.slice(0, 20)}...` : entityMatch.id;
    }

    addRecentItem({
      id: itemKey,
      type: entityMatch.type,
      label,
      description: entityMatch.typeLabel,
      path: url.startsWith("/") ? url : `/${url}`,
      iconName: entityMatch.iconName,
      projectSlug,
    });
  }, [url, projectSlug, addRecentItem]);
}
