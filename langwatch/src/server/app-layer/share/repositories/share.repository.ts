import type { PublicShare } from "@prisma/client";

export type ShareResourceType = "TRACE" | "THREAD";

export interface ShareWithProject extends PublicShare {
  project: { traceSharingEnabled: boolean };
}

export interface ShareRepository {
  findById(id: string): Promise<ShareWithProject | null>;

  findByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<PublicShare | null>;

  findByResourceType(params: {
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<PublicShare | null>;

  create(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    userId?: string | null;
  }): Promise<PublicShare>;

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
