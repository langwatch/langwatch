import type { Project } from "@prisma/client";

/**
 * Who to notify about a project, and whether this is its first activity.
 *
 * Lives here rather than on the service because the pipelines that consume it
 * must not import `app-layer` — see ADR-063. `ProjectService` satisfies this
 * structurally; nothing needs to declare that it implements it.
 */
export interface OrgAdminResolution {
  userId: string | null;
  organizationId: string | null;
  firstMessage: boolean;
}

/** The metadata an onboarding signal writes back to a project. */
export interface ProjectMetadataUpdate {
  id: string;
  data: { firstMessage: boolean; integrated: boolean; language: string };
}

/**
 * The slice of the project service that event-sourcing pipelines actually use:
 * three methods out of twelve.
 *
 * Declaring the port here is what turns the `app-layer` <-> `event-sourcing`
 * cycle into a DAG for this edge. The pipelines depend on the shape they need;
 * the composition root supplies the implementation.
 */
export interface ProjectServicePort {
  getById(id: string): Promise<Project | null>;
  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
  updateMetadata(input: ProjectMetadataUpdate): Promise<void>;
}
