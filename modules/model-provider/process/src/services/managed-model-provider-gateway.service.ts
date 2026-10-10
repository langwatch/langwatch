import type { ManagedProviderApi } from "@langwatch/enterprise-managed-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * Whether LangWatch itself supplies a provider's credentials, and with what. The app answers it
 * from the managed-provider peer; the unmanaged stand-in serves only a runtime composed without it.
 */
export abstract class ModelProviderManagedGateway {
  abstract isManaged(input: { organizationId: string; provider: string }): boolean;
  abstract prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>>;
}

/**
 * The managed-provider answer taken from the managed-provider module: which organizations
 * LangWatch supplies a provider's credentials for, and the parameters a managed call runs with.
 * This side names the project's organization, so managed-provider needs no project peer.
 */
export class ManagedModelProviderGatewayService extends ModelProviderManagedGateway {
  static create(input: {
    managed: ManagedProviderApi;
    projects: Pick<ProjectApi, "findOrganizationId">;
  }): ManagedModelProviderGatewayService {
    return new ManagedModelProviderGatewayService(input.managed, input.projects);
  }

  private readonly projectOrganizations = new Map<string, string>();

  private constructor(
    private readonly managed: ManagedProviderApi,
    private readonly projects: Pick<ProjectApi, "findOrganizationId">,
  ) {
    super();
  }

  isManaged(input: { organizationId: string; provider: string }): boolean {
    return this.managed.isManagedProvider(input);
  }

  async prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    const organizationId = await this.findOrganization(input.projectId);
    if (!organizationId) return input.parameters;

    return this.managed.buildLitellmParameters({
      params: input.parameters,
      projectId: input.projectId,
      organizationId,
      model: input.model,
      modelProvider: { provider: input.provider },
    });
  }

  /** A project never changes organization, so each lookup is kept for the process's life. */
  private async findOrganization(projectId: string): Promise<string | undefined> {
    const cached = this.projectOrganizations.get(projectId);
    if (cached) return cached;

    const organizationId = await this.projects.findOrganizationId(projectId);
    if (organizationId) this.projectOrganizations.set(projectId, organizationId);

    return organizationId;
  }
}
