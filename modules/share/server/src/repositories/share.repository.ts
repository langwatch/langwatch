import type { Instant } from "@langwatch/time";
import type {
  ShareLink,
  ShareResourceType,
  ShareVisibility,
  ShareWithProject,
} from "@langwatch/share-contract";

export interface CreateShareLinkParams {
  token: string;
  projectId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  visibility?: ShareVisibility;
  expiresAt?: Instant | null;
  maxViews?: number | null;
  userId?: string | null;
}

export interface ShareResourceScope {
  projectId: string;
  resourceType: ShareResourceType;
  resourceId: string;
}

export interface ShareLinkScope {
  id: string;
  projectId: string;
}

export interface ConsumeShareViewParams extends ShareLinkScope {
  maxViews: number | null;
}

/** Both kill switches a mint is refused by, read from the project row. */
export interface ShareTraceSharingConfig {
  orgEnabled: boolean;
  projectEnabled: boolean;
}

export interface ShareRepository {
  /**
   * Whether the organisation and the project both still allow trace sharing.
   * Read here rather than through `ProjectApi`, which does not declare it; the
   * same two columns already ride every token resolution below.
   */
  findTraceSharingConfig(projectId: string): Promise<ShareTraceSharingConfig | null>;

  /** Resolve a token with the project context used by sharing policy. */
  findByToken(token: string): Promise<ShareWithProject | null>;

  /** Resolve a project-scoped link without loading a cross-tenant row. */
  findById(params: ShareLinkScope): Promise<ShareWithProject | null>;

  /** Whether this head still names the link, without loading its project. */
  existsById(params: ShareLinkScope): Promise<boolean>;

  findAllByResource(params: ShareResourceScope): Promise<ShareLink[]>;

  /** An exhausted but unexpired link still keeps its trace pinned. */
  countActiveForResource(params: ShareResourceScope): Promise<number>;

  create(params: CreateShareLinkParams): Promise<ShareLink>;

  /** Atomically consume one project-scoped view without exceeding the cap. */
  consumeView(params: ConsumeShareViewParams): Promise<boolean>;

  /** The ids this head can see, used to name links before revoking them. */
  findAllIdsByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId?: string;
  }): Promise<string[]>;

  deleteById(params: ShareLinkScope): Promise<void>;

  deleteByResource(params: ShareResourceScope): Promise<void>;

  findAllTraceShareResourceIds(projectId: string): Promise<string[]>;

  deleteAllTraceShares(projectId: string): Promise<void>;
}
