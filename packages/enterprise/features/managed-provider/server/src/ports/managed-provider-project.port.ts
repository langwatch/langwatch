export abstract class ManagedProviderProjectRepository {
  abstract tryGetOrganizationId(projectId: string): Promise<string | null>;
}
