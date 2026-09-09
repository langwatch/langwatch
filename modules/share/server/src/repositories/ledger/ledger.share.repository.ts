/**
 * Cut-over organisations write links through the grants ledger while all
 * reads use the compatible ShareLink head. GrantUsage owns view counts; the
 * ShareLink count is its rollback-safe mirror (ADR-092, decision 22).
 */
import type { LedgerActor } from "@langwatch/actor";
import {
  AUTHZ_SHARE_PERMISSION,
  type AuthzApi,
  authzShareAudience,
} from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nanoid } from "nanoid";
import type { ShareLink, ShareResourceType, ShareWithProject } from "@langwatch/share-contract";
import type { ShareGrantRepository } from "../share-grant.repository.ts";
import type {
  ConsumeShareViewParams,
  CreateShareLinkParams,
  ShareLinkScope,
  ShareRepository,
  ShareResourceScope,
} from "../share.repository.ts";

/** Revocations are system actions; link authorship remains on the mint fact. */
const SYSTEM_ACTOR: LedgerActor = { type: "system", id: null };

/** The project peer, narrowed to the tenancy answer the ledger fences grants by. */
type LedgerProjectPeer = Pick<ProjectApi, "tryGetOrganizationId">;

type LedgerShareDependencies = {
  head: ShareRepository;
  grants: ShareGrantRepository;
  authz: AuthzApi;
  projects: LedgerProjectPeer;
};

export class LedgerShareRepository implements ShareRepository {
  readonly #head: ShareRepository;
  readonly #grants: ShareGrantRepository;
  readonly #authz: AuthzApi;
  readonly #projects: LedgerProjectPeer;

  static create(deps: LedgerShareDependencies): LedgerShareRepository {
    return new LedgerShareRepository(deps);
  }

  private constructor(deps: LedgerShareDependencies) {
    this.#head = deps.head;
    this.#grants = deps.grants;
    this.#authz = deps.authz;
    this.#projects = deps.projects;
  }

  async findByToken(token: string): Promise<ShareWithProject | null> {
    return this.#head.findByToken(token);
  }

  async findById(params: ShareLinkScope): Promise<ShareWithProject | null> {
    return this.#head.findById(params);
  }

  async existsById(params: ShareLinkScope): Promise<boolean> {
    return this.#head.existsById(params);
  }

  async findAllByResource(params: ShareResourceScope): Promise<ShareLink[]> {
    return this.#head.findAllByResource(params);
  }

  async countActiveForResource(params: ShareResourceScope): Promise<number> {
    return this.#head.countActiveForResource(params);
  }

  async findAllIdsByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId?: string;
  }): Promise<string[]> {
    return this.#head.findAllIdsByResource(params);
  }

  async findAllTraceShareResourceIds(projectId: string): Promise<string[]> {
    return this.#head.findAllTraceShareResourceIds(projectId);
  }

  /** Mint the shared id before the fact so the grant and compat row agree. */
  async create(params: CreateShareLinkParams): Promise<ShareLink> {
    const organizationId = await this.#ledgerOrganizationFor(params.projectId);
    if (!organizationId) return this.#head.create(params);

    const id = nanoid();
    const visibility = params.visibility ?? "PUBLIC";
    await this.#authz.attachResourceGrant({
      organizationId,
      grantId: id,
      projectId: params.projectId,
      principal: authzShareAudience({
        visibility,
        organizationId,
        projectId: params.projectId,
      }),
      scopeId: params.resourceId,
      resource: {
        token: params.token,
        permission: AUTHZ_SHARE_PERMISSION,
        kind: params.resourceType === "THREAD" ? "thread" : "trace",
        ...(params.expiresAt ? { expiresAtMs: params.expiresAt.epochMilliseconds } : {}),
        ...(params.maxViews != null ? { maxViews: params.maxViews } : {}),
        ...(params.userId ? { createdByUserId: params.userId } : {}),
      },
      actor: params.userId ? { type: "user", id: params.userId } : { type: "system", id: null },
    });

    const row = await this.#head.findById({ id, projectId: params.projectId });
    if (!row) {
      // The fact is durable but its compatible read row has not landed.
      throw new Error(
        `share link ${id} was recorded on the grants ledger but its compat row has not landed; the projection queue is stalled`,
      );
    }
    return row;
  }

  /**
   * Revoke by the shared grant/link id. This remains correct while the fold is
   * between its compatible row and Grant-head writes, and prevents revival.
   */
  async deleteById({ id, projectId }: ShareLinkScope): Promise<void> {
    const organizationId = await this.#revocationOrganizationFor(projectId);
    if (!organizationId) return this.#head.deleteById({ id, projectId });

    if (!(await this.#linkNamedAt({ organizationId, projectId, id }))) {
      // An unanchored id must not become an organisation-wide revocation.
      return;
    }
    await this.#authz.revokeResourceGrants({
      organizationId,
      grantIds: [id],
      actor: SYSTEM_ACTOR,
    });
    // Delete the compatible row synchronously so revocation is immediate.
    await this.#head.deleteById({ id, projectId });
  }

  async deleteByResource({
    projectId,
    resourceType,
    resourceId,
  }: ShareResourceScope): Promise<void> {
    const organizationId = await this.#revocationOrganizationFor(projectId);
    if (!organizationId) {
      return this.#head.deleteByResource({ projectId, resourceType, resourceId });
    }
    await this.#revokeKnownLinks({
      organizationId,
      projectId,
      resourceKind: resourceType,
      resourceId,
    });
    await this.#head.deleteByResource({ projectId, resourceType, resourceId });
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    const organizationId = await this.#revocationOrganizationFor(projectId);
    if (!organizationId) return this.#head.deleteAllTraceShares(projectId);

    await this.#revokeKnownLinks({
      organizationId,
      projectId,
      resourceKind: "TRACE",
    });
    await this.#head.deleteAllTraceShares(projectId);
  }

  /** Consume GrantUsage and mirror it for a safe rollback to ShareLink. */
  async consumeView({ id, projectId, maxViews }: ConsumeShareViewParams): Promise<boolean> {
    const organizationId = await this.#ledgerOrganizationFor(projectId);
    if (!organizationId) {
      return this.#head.consumeView({ id, projectId, maxViews });
    }
    const grantIds = await this.#grants.findAllResourceGrantIds({
      organizationId,
      projectId,
      id,
    });
    if (grantIds.length === 0) {
      // A rollback-window mint has no GrantUsage authority.
      return this.#head.consumeView({ id, projectId, maxViews });
    }

    return this.#grants.consumeUsage({
      grantId: id,
      organizationId,
      projectId,
      maxViews,
    });
  }

  /** Check both heads before appending a project-scoped revocation. */
  async #linkNamedAt({
    organizationId,
    projectId,
    id,
  }: {
    organizationId: string;
    projectId: string;
    id: string;
  }): Promise<boolean> {
    if (await this.#head.existsById({ id, projectId })) return true;
    const grantIds = await this.#grants.findAllResourceGrantIds({
      organizationId,
      projectId,
      id,
    });
    return grantIds.length > 0;
  }

  /** Revoke ids visible in either head before the compatible-row sweep. */
  async #revokeKnownLinks({
    organizationId,
    projectId,
    resourceKind,
    resourceId,
  }: {
    organizationId: string;
    projectId: string;
    resourceKind: ShareResourceType;
    resourceId?: string;
  }): Promise<void> {
    // A fold may expose the compatible row before its Grant head.
    const [compatIds, grantIds] = await Promise.all([
      this.#head.findAllIdsByResource({
        projectId,
        resourceType: resourceKind,
        ...(resourceId !== void 0 ? { resourceId } : {}),
      }),
      this.#grants.findAllResourceGrantIds({
        organizationId,
        projectId,
        resourceKind,
        ...(resourceId !== void 0 ? { resourceId } : {}),
      }),
    ]);
    const ids = [...new Set([...compatIds, ...grantIds])];
    if (ids.length > 0) {
      await this.#authz.revokeResourceGrants({
        organizationId,
        grantIds: ids,
        actor: SYSTEM_ACTOR,
      });
    }
  }

  /** Resolve the organisation and use the compat head unless AuthZ reports cut-over. */
  async #ledgerOrganizationFor(projectId: string): Promise<string | null> {
    const organizationId = await this.#organizationOf(projectId);
    if (!organizationId) return null;
    const onEngine = await this.#authz.isOnEngine({ organizationId });
    return onEngine ? organizationId : null;
  }

  /**
   * Revocations deliberately bypass the cached cut-over gate: a stale legacy
   * route could leave the Grant head live and let projection revive the link.
   */
  async #revocationOrganizationFor(projectId: string): Promise<string | null> {
    return this.#organizationOf(projectId);
  }

  /** The organisation a project sits in, asked of the module that owns the row. */
  async #organizationOf(projectId: string): Promise<string | null> {
    return (await this.#projects.tryGetOrganizationId(projectId)) ?? null;
  }
}
