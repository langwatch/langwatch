export abstract class ManagedProviderProjectRepository {
  abstract getOrganizationId(projectId: string): Promise<string | null>;
}
