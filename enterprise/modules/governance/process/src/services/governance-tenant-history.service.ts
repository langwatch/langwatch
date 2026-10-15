// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import {
  type InternalProject,
  type InternalProjectQuery,
  PROJECT_KIND,
  type ProjectApi,
} from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import type { GovernanceTenantHistoryRepository } from "../repositories/governance-tenant-history.repository.ts";

const logger = createLogger("langwatch:governance:tenant-history");

/**
 * Every route to a governance tenant ensures the hidden project, so recording
 * the use here keeps the erasure walk's history complete (ADR-128 §11).
 */
export class GovernanceTenantHistoryService implements Pick<ProjectApi, "ensureInternal"> {
  private constructor(
    private readonly projects: Pick<ProjectApi, "ensureInternal">,
    private readonly history: GovernanceTenantHistoryRepository,
  ) {}

  static create({
    projects,
    history,
  }: {
    projects: Pick<ProjectApi, "ensureInternal">;
    history: GovernanceTenantHistoryRepository;
  }): GovernanceTenantHistoryService {
    return new GovernanceTenantHistoryService(projects, history);
  }

  async ensureInternal(input: InternalProjectQuery): Promise<InternalProject> {
    const project = await this.projects.ensureInternal(input);
    if (input.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) {
      await this.recordUse({ organizationId: input.organizationId, tenantId: project.id });
    }
    return project;
  }

  /** Never throws: a missed record is logged loudly and the next use records it, as main did. */
  private async recordUse(input: { organizationId: string; tenantId: string }): Promise<void> {
    const at = Temporal.Now.instant();
    try {
      if (await this.history.touch({ ...input, at })) return;
      await this.history.append({ ...input, at });
    } catch (error) {
      logger.error(
        { error, ...input },
        "Failed to record a governance tenant in the history; a later erasure could miss rows written under it",
      );
    }
  }
}
