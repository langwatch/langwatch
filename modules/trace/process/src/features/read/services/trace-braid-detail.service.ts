import { type Authorization, ownProjectIdReadBy } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SpanBraid } from "@langwatch/trace-contract";

import { braidConditionsShownFor } from "../../../rules/braided-span-owner.rules.ts";

/** The peers a braided read asks about owners and audits through (ADR-183 §5, §8). */
export interface TraceBraidDirectory {
  authz: Pick<AuthzApi, "hasPermission" | "listBraids" | "recordBraidedSpansView">;
  projects: Pick<ProjectApi, "findSummaryById">;
}

/** What a braided span says about its owner, and the audit of reads that showed owner spans. */
export class TraceBraidDetailService {
  static create({ directory }: { directory: TraceBraidDirectory | null }): TraceBraidDetailService {
    return new TraceBraidDetailService(directory);
  }

  readonly #directory: TraceBraidDirectory | null;
  readonly #logger = createLogger("langwatch:trace:braid-detail");

  private constructor(directory: TraceBraidDirectory | null) {
    this.#directory = directory;
  }

  /** The span panel's `braid`: the owner's slug only for a viewer who may open the owner. */
  async describe({
    readerProjectId,
    ownerProjectId,
    viewerUserId,
    spanStartedAtMs,
  }: {
    readerProjectId: string;
    ownerProjectId: string;
    viewerUserId: string;
    spanStartedAtMs: number;
  }): Promise<SpanBraid> {
    const directory = this.#directory;
    if (directory === null) {
      return {
        ownerProjectId,
        ownerName: ownerProjectId,
        ownerProjectSlug: null,
        canOpenOwner: false,
        matchedConditions: [],
        signedBy: null,
      };
    }
    const [owner, canReadOwner, braids] = await Promise.all([
      directory.projects.findSummaryById(ownerProjectId),
      directory.authz.hasPermission({
        userId: viewerUserId,
        permission: "traces:view",
        projectId: ownerProjectId,
      }),
      directory.authz.listBraids({ projectId: readerProjectId }),
    ]);
    const canOpenOwner = canReadOwner && owner !== null;
    return {
      ownerProjectId,
      ownerName: owner?.name ?? ownerProjectId,
      ownerProjectSlug: canOpenOwner ? owner.slug : null,
      canOpenOwner,
      matchedConditions: braidConditionsShownFor({
        braids: braids.fromOtherProjects,
        ownerProjectId,
        spanStartedAtMs,
      }),
      signedBy: null,
    };
  }

  /** One audit call for a read that returned owner spans; an audit failure never fails the read. */
  async recordView({
    authorization,
    ownerProjectIds,
  }: {
    authorization: Authorization;
    ownerProjectIds: readonly (string | null | undefined)[];
  }): Promise<void> {
    const owners = [...new Set(ownerProjectIds.filter((id): id is string => !!id))];
    if (owners.length === 0 || this.#directory === null) return;
    const readerProjectId = ownProjectIdReadBy(authorization);
    try {
      await this.#directory.authz.recordBraidedSpansView({
        actor: authorization.actor,
        readerProjectId,
        ownerProjectIds: owners,
      });
    } catch (error) {
      this.#logger.warn({ error, readerProjectId }, "braided spans view was not audited");
    }
  }
}
