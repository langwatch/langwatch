/**
 * The org-wide prompt count `NurturingPromptCreationService.afterPromptCreated`
 * needs, kept behind its own repository so the service never imports a
 * database client directly.
 */
export abstract class NurturingPromptCountRepository {
  /** The organization a project belongs to, where the project still exists. */
  abstract tryFindOrganizationId(projectId: string): Promise<string | undefined>;

  /** Every non-deleted, versioned prompt across the whole organization. */
  abstract countOrganizationPrompts(organizationId: string): Promise<number>;
}
