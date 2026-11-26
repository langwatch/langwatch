/**
 * The store project (ADR-002, decision 3): where a board made outside a project view is kept.
 * The server names the projects with Dashboards on where the member may create; the project in
 * view, the member's last-used, wins among them, else the first by name. None, nothing to make.
 */

import type { DashboardProject } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";

export type StoreProject = {
  storeProject: DashboardProject | undefined;
  /** Every project the member may create a board in; the store project is one of them. */
  storeProjects: readonly DashboardProject[];
  /** The names the boards stored there already have, so a new one is numbered past them. */
  namesInStore: readonly string[];
  /** Whether it also grants `analytics:update`, which a board made Only me or Organization asks. */
  mayShare: boolean;
  isLoading: boolean;
  /** Why the store projects could not be read, after their retries; null while none failed. */
  error: unknown;
  retry: () => void;
};

export function useStoreProject({ enabled = true }: { enabled?: boolean } = {}): StoreProject {
  const host = useAnalyticsHost();
  const organizationId = host.organizationId() ?? "";
  const lastUsedId = host.project()?.id;
  const asks = enabled && organizationId !== "";
  const candidates = analyticsApi.boards.storeProjects.useQuery(
    { organizationId },
    { enabled: asks },
  );
  const listed = analyticsApi.boards.listInOrganization.useQuery(
    { organizationId },
    { enabled: asks },
  );
  const isPending = (read: { data?: unknown; isError: boolean }) =>
    read.data === void 0 && !read.isError;
  const isLoading = asks && (isPending(candidates) || isPending(listed));
  const projects = candidates.data ?? [];
  const read = {
    storeProjects: projects,
    isLoading,
    error: candidates.error,
    retry: () => void candidates.refetch(),
  };
  const storeProject = projects.find((project) => project.id === lastUsedId) ?? projects[0];
  if (!storeProject) return { storeProject, namesInStore: [], mayShare: false, ...read };
  const update = { projectId: storeProject.id, permission: "analytics:update" };
  const mayShare = host.hasPermissionIn(update);
  const namesInStore = (listed.data ?? [])
    .filter((board) => board.project?.id === storeProject.id)
    .map((board) => board.name);
  return { storeProject, namesInStore, mayShare, ...read };
}
