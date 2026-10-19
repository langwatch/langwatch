/**
 * The largest file a run reads for one image or file cell, as the project's
 * organization answers it.
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

/** How long an answer is kept, so the cells of one run ask once between them. */
const LIMIT_TTL_MS = 60_000;

/** Projects remembered at once; the oldest answer leaves first. */
const REMEMBERED_PROJECTS = 500;

type Remembered = { maxBytes: Promise<number>; expiresAtMs: number };

export class ExperimentAttachmentLimitService {
  static create(deps: {
    entitlements: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
  }): ExperimentAttachmentLimitService {
    return new ExperimentAttachmentLimitService(deps.entitlements, deps.projects);
  }

  private readonly remembered = new Map<string, Remembered>();

  private constructor(
    private readonly entitlements: Pick<EntitlementApi, "requestBound">,
    private readonly projects: Pick<ProjectApi, "getOrganizationId">,
  ) {}

  /** The organization's per-file limit in bytes; a failed lookup is asked again next time. */
  maxBytesFor(projectId: string): Promise<number> {
    const nowMs = nowInstant().epochMilliseconds;
    const known = this.remembered.get(projectId);
    if (known && known.expiresAtMs > nowMs) return known.maxBytes;

    const maxBytes = this.resolve(projectId);
    this.remembered.delete(projectId);
    this.remembered.set(projectId, { maxBytes, expiresAtMs: nowMs + LIMIT_TTL_MS });
    maxBytes.catch(() => this.remembered.delete(projectId));
    for (const oldest of this.remembered.keys()) {
      if (this.remembered.size <= REMEMBERED_PROJECTS) break;
      this.remembered.delete(oldest);
    }

    return maxBytes;
  }

  private async resolve(projectId: string): Promise<number> {
    const organizationId = await this.projects.getOrganizationId(projectId);

    return this.entitlements.requestBound({ key: "datasetAttachmentBytes", organizationId });
  }
}
