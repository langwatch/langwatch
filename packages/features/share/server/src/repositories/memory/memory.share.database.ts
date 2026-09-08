import type { ShareLink, ShareWithProject } from "@langwatch/share-contract";
import type { Instant } from "@langwatch/time";

/** A project as the two memory heads see it: its organisation and both kill switches. */
export type MemoryShareProject = Readonly<{
  id: string;
  organizationId: string | null;
  traceSharingEnabled: boolean;
  organizationTraceSharingEnabled: boolean;
}>;

export type MemoryShareGrant = {
  id: string;
  organizationId: string;
  projectId: string;
  scopeType: string;
  resourceKind: string | null;
  scopeId: string | null;
  revokedAt: Instant | null;
};

export type MemoryShareUsage = {
  grantId: string;
  organizationId: string;
  projectId: string;
  viewCount: number;
  lastViewedAt: Instant;
};

/** The rows the share and grant memory twins share, so both read one world. */
export class MemoryShareDatabase {
  readonly links: ShareLink[] = [];
  readonly projects: MemoryShareProject[] = [];
  readonly grants: MemoryShareGrant[] = [];
  readonly usages: MemoryShareUsage[] = [];

  static create(): MemoryShareDatabase {
    return new MemoryShareDatabase();
  }

  project(projectId: string): MemoryShareProject | undefined {
    return this.projects.find((project) => project.id === projectId);
  }

  link(id: string, projectId: string): ShareLink | undefined {
    return this.links.find((link) => link.id === id && link.projectId === projectId);
  }

  /** The project context sharing policy reads beside a link. */
  withProject(link: ShareLink): ShareWithProject {
    const project = this.project(link.projectId);

    return {
      ...link,
      project: {
        traceSharingEnabled: project?.traceSharingEnabled ?? true,
        team: {
          organizationId: project?.organizationId ?? `organization_of_${link.projectId}`,
          organization: {
            traceSharingEnabled: project?.organizationTraceSharingEnabled ?? true,
          },
        },
      },
    };
  }
}
