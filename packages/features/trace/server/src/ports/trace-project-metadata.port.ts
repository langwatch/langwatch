import type {
  OrgAdminResolution,
  Project,
  UpdateProjectMetadataInput,
} from "@langwatch/project-contract";

/**
 * The three things the `projectMetadata` subscriber does to a project.
 *
 * It named the whole `ProjectService` before, which is fourteen capabilities
 * wide and reaches organizations, the LWQL ClickHouse key map and stored
 * objects. A background process that wanted to run this one subscriber had to
 * be able to build all of it — which is why this subscriber, and everything
 * queued behind it, could not leave the application.
 *
 * The published `ProjectService` satisfies this structurally, so the
 * application keeps passing exactly what it passed before and a process that
 * holds only a project row and an org-admin lookup can now answer it too.
 */
export abstract class TraceProjectMetadataPort {
  abstract tryGetById(id: string): Promise<Project | null>;
  abstract updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  /**
   * The org admin's user id, which is also the distinct_id posthog-js
   * identifies the same person with in the browser.
   */
  abstract resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
}
