import type {
  ShareLink,
  ShareResourceType,
  ShareVisibility,
  ShareWithProject,
} from "@langwatch/share-contract";

export type { ShareResourceType, ShareWithProject } from "@langwatch/share-contract";

export interface CreateShareLinkParams {
  token: string;
  projectId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  visibility?: ShareVisibility;
  expiresAt?: Date | null;
  maxViews?: number | null;
  userId?: string | null;
}

export abstract class ShareRepository {
  /** Resolve a token with the project context used by sharing policy. */
  abstract tryFindByToken(token: string): Promise<ShareWithProject | null>;

  /** Resolve a project-scoped link without loading a cross-tenant row. */
  abstract tryFindById(params: {
    id: string;
    projectId: string;
  }): Promise<ShareWithProject | null>;

  abstract listByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<ShareLink[]>;

  /** An exhausted but unexpired link still keeps its trace pinned. */
  abstract hasActiveShareForResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<boolean>;

  abstract create(params: CreateShareLinkParams): Promise<ShareLink>;

  /** Atomically consume one project-scoped view without exceeding the cap. */
  abstract consumeView(params: {
    id: string;
    projectId: string;
    maxViews: number | null;
  }): Promise<boolean>;

  abstract deleteById(params: { id: string; projectId: string }): Promise<void>;

  abstract deleteByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<void>;

  abstract findAllTraceShareResourceIds(projectId: string): Promise<string[]>;

  abstract deleteAllTraceShares(projectId: string): Promise<void>;
}
