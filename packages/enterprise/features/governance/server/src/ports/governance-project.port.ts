// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  InternalProject,
  InternalProjectQuery,
  ProjectWithTeam,
} from "@langwatch/project-contract";

/**
 * The two project reads Governance makes: the tenant a pull writes under, and
 * the hidden per-organization project every receiver ensures.
 *
 * Stated here in contract types rather than taken off the project feature's
 * server package, so composing it stays the process's job. The project
 * capability satisfies it as it stands.
 */
export abstract class GovernanceProjectPort {
  abstract tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;

  abstract ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
}
