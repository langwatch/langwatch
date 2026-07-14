import type { ShareLink, ShareVisibility } from "@prisma/client";

export type ShareResourceType = "TRACE" | "THREAD";

export interface ShareWithProject extends ShareLink {
  project: {
    traceSharingEnabled: boolean;
    team: { organizationId: string };
  };
}

export interface CreateShareLinkParams {
  token: string;
  projectId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  threadId?: string | null;
  visibility?: ShareVisibility;
  expiresAt?: Date | null;
  maxViews?: number | null;
  userId?: string | null;
}

export interface ShareRepository {
  /** Resolve a share by its secret token — the anonymous read path. Includes
   *  the project context needed to gate on the sharing kill switch and audience. */
  findByToken(token: string): Promise<ShareWithProject | null>;

  findById(id: string): Promise<ShareWithProject | null>;

  /** All links for a resource, newest first — backs the management list. */
  listByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<ShareLink[]>;

  /** Whether an unexpired link exists for the resource. Used by the pinning
   *  service to keep a trace pinned while it is shared. Conservative: a
   *  view-capped link that is exhausted still counts as active (harmless — it
   *  only defers unpinning). */
  hasActiveShareForResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<boolean>;

  create(params: CreateShareLinkParams): Promise<ShareLink>;

  /** Project-scoped so the multitenancy guard is satisfied and a view can never
   *  be counted against another tenant's link. Returns true if a view was
   *  consumed, false if the link is exhausted or already deleted. */
  incrementViewCount(params: {
    id: string;
    projectId: string;
    maxViews: number | null;
  }): Promise<boolean>;

  /** Revoke a single link, scoped to its project. */
  deleteById(params: { id: string; projectId: string }): Promise<void>;

  /** Revoke every link for a resource (thread unshare, kill switch). */
  deleteByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<void>;

  /** Returns the resourceIds (trace ids) of all TRACE-typed shares for the
   *  project. Used by the service to enumerate which traces need an
   *  auto-unpin pass before a bulk revocation. */
  findAllTraceShareResourceIds(projectId: string): Promise<string[]>;

  deleteAllTraceShares(projectId: string): Promise<void>;
}
