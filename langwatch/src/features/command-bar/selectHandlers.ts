import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { DrawerType } from "~/components/drawerRegistry";
import type { Command, RecentItem, SearchResult } from "./types";

/**
 * Navigation helper type for handling tab behavior.
 */
export interface NavigationContext {
  router: { push: (url: string) => Promise<boolean> };
  newTab: boolean;
  close: () => void;
}

/**
 * Recent item tracking helper.
 */
export type AddRecentItem = (item: Omit<RecentItem, "accessedAt">) => void;

/**
 * Drawer opening helper.
 */
export type OpenDrawer = (
  drawer: DrawerType,
  params?: Record<string, string>,
) => void;

/**
 * Create a navigation helper that handles tab behavior.
 */
export function createNavigate(ctx: NavigationContext) {
  return (path: string) => {
    if (ctx.newTab) {
      window.open(path, "_blank");
    } else {
      void ctx.router.push(path);
    }
    ctx.close();
  };
}

/**
 * Handle selection of a command item.
 */
export function handleCommandSelect(
  cmd: Command,
  projectSlug: string,
  ctx: NavigationContext,
  addRecentItem: AddRecentItem,
  openDrawer: OpenDrawer,
) {
  const navigate = createNavigate(ctx);

  if (cmd.category === "navigation" && cmd.path) {
    // Extract parent context from description (e.g., "Settings → Teams" becomes "Settings")
    const parentContext = cmd.description?.includes("→")
      ? cmd.description.split("→")[0]?.trim()
      : undefined;
    addRecentItem({
      id: cmd.id,
      type: "page",
      label: cmd.label,
      description: parentContext,
      path: cmd.path.replace("[project]", projectSlug),
      iconName: cmd.id.replace("nav-", ""),
      projectSlug,
    });
  }

  if (cmd.path) {
    const path = cmd.path.replace("[project]", projectSlug);
    navigate(path);
    return;
  }

  switch (cmd.id) {
    case "action-new-agent":
      ctx.close();
      openDrawer("agentTypeSelector");
      break;
    case "action-new-evaluation":
      ctx.close();
      openDrawer("evaluatorCategorySelector");
      break;
    case "action-new-prompt":
      ctx.close();
      openDrawer("promptEditor");
      break;
    case "action-new-dataset":
      ctx.close();
      openDrawer("addOrEditDataset");
      break;
    case "action-new-scenario":
      navigate(`/${projectSlug}/simulations/scenarios`);
      break;
    case "action-sdk-radar":
      ctx.close();
      openDrawer("sdkRadar");
      break;
  }
}

/**
 * Handle selection of a search result item.
 */
export function handleSearchResultSelect(
  result: SearchResult,
  projectSlug: string,
  ctx: NavigationContext,
  addRecentItem: AddRecentItem,
  openDrawer: OpenDrawer,
) {
  const navigate = createNavigate(ctx);

  // Check if this should open a drawer instead of navigating
  if (result.drawerAction) {
    addRecentItem({
      id: result.id,
      type: result.type === "trace" ? "trace" : "entity",
      label: result.label,
      description: result.type.charAt(0).toUpperCase() + result.type.slice(1),
      path: result.path,
      iconName: result.type,
      projectSlug,
    });
    ctx.close();
    openDrawer(result.drawerAction.drawer, result.drawerAction.params);
  } else {
    addRecentItem({
      id: result.id,
      type: "entity",
      label: result.label,
      path: result.path,
      iconName: result.type,
      projectSlug,
    });
    navigate(result.path);
  }
}

/**
 * Handle selection of a recent item.
 */
export function handleRecentItemSelect(
  item: RecentItem,
  ctx: NavigationContext,
  addRecentItem: AddRecentItem,
  openDrawer: OpenDrawer,
) {
  const navigate = createNavigate(ctx);

  addRecentItem({
    id: item.id,
    type: item.type,
    label: item.label,
    description: item.description,
    path: item.path,
    iconName: item.iconName,
    projectSlug: item.projectSlug,
  });

  // Open traces in drawer, navigate for everything else
  if (item.type === "trace") {
    // Extract trace ID from path (e.g., "/project/messages/traceId?tab=details")
    const lastSegment = item.path.split("/").pop() ?? "";
    const traceId = lastSegment.split("?")[0]?.split("#")[0];
    if (traceId) {
      ctx.close();
      openDrawer("traceDetails", { traceId });
    }
  } else {
    navigate(item.path);
  }
}

/**
 * Handle selection of a project item.
 */
export function handleProjectSelect(
  project: { slug: string; name: string },
  ctx: NavigationContext,
  addRecentItem: AddRecentItem,
) {
  const navigate = createNavigate(ctx);

  addRecentItem({
    id: `project-${project.slug}`,
    type: "project",
    label: project.name,
    path: `/${project.slug}`,
    iconName: "project",
    projectSlug: project.slug,
  });
  navigate(`/${project.slug}`);
}
