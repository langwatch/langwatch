/**
 * Whether a project's judged queries send the `search` route: its own rollout flag, read for the
 * project within its organization so an organization rule applies (ADR-190 decision 13).
 * @see specs/lwql/eval-functions.feature
 */

import { INSTANT_EVALS_SEARCH_ROUTER_FLAG } from "@langwatch/instant-eval-contract";

import type {
  InstantEvalFlagReader,
  InstantEvalProjectReader,
} from "./instant-eval-access.service.ts";

export class InstantEvalSearchRoutingService {
  private constructor(
    private readonly flags: InstantEvalFlagReader,
    private readonly projects: InstantEvalProjectReader,
  ) {}

  static create({
    flags,
    projects,
  }: {
    flags: InstantEvalFlagReader;
    projects: InstantEvalProjectReader;
  }): InstantEvalSearchRoutingService {
    return new InstantEvalSearchRoutingService(flags, projects);
  }

  /** A project with no organization reads as off: no organization rule could name it. */
  async isRouted({ projectId }: { projectId: string }): Promise<boolean> {
    const organizationId = await this.projects.findOrganizationId(projectId);
    if (!organizationId) return false;
    return this.flags.isEnabled(INSTANT_EVALS_SEARCH_ROUTER_FLAG, {
      kind: "project",
      projectId,
      organizationId,
    });
  }
}
