// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  PROJECT_KIND,
  type InternalProject,
  type ProjectKind,
} from "@langwatch/project-contract";
import { getApp } from "~/server/app-layer/app";

export { PROJECT_KIND };
export type { ProjectKind };

export type AppGovernanceProject = Omit<InternalProject, "archivedAtMs"> & {
  archivedAt: Date | null;
};

function toAppProject(project: InternalProject): AppGovernanceProject {
  const { archivedAtMs, ...portable } = project;
  return {
    ...portable,
    archivedAt: archivedAtMs === null ? null : new Date(archivedAtMs),
  };
}

/** Read-only app adapter; never provisions on a GET path. */
export async function findHiddenGovernanceProject(input: {
  prisma: object;
  organizationId: string;
}): Promise<AppGovernanceProject | null> {
  const project = await getApp().projects.tryFindInternal({
    organizationId: input.organizationId,
    kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
  });
  return project ? toAppProject(project) : null;
}

/** Lazy app adapter over the canonical idempotent Postgres service. */
export async function ensureHiddenGovernanceProject(
  database: object,
  organizationId: string,
): Promise<AppGovernanceProject> {
  void database;
  return toAppProject(
    await getApp().projects.ensureInternal({
      organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    }),
  );
}
