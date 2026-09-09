/**
 * A person's own workspace: the organization, team and project minted for them on first
 * sight, and the per-feature switches on that project. Only the owner may read or change
 * them, and a project that is not a personal one is refused rather than quietly edited.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { AuthzLedgerUnavailableError, type AuthzApi } from "@langwatch/authz-contract";
import {
  PersonalProjectOwnerMismatchError,
  findPersonalWorkspaceInputSchema,
  personalWorkspaceFeaturesInputSchema,
  personalWorkspaceInputSchema,
  readPersonalFeatures,
  type EnsuredPersonalWorkspace,
  type FindPersonalWorkspaceInput,
  type PersonalFeatures,
  type PersonalWorkspace,
  type PersonalWorkspaceFeaturesInput,
  type PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import type {
  OrganizationRepository,
  PersonalWorkspaceFeatureProject,
} from "../repositories/organization.repository.ts";
import type {
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceIdentityPort,
} from "../ports/organization.port.ts";

const ALL_PERSONAL_FEATURES_DISABLED: PersonalFeatures = {
  evaluations: false,
  datasets: false,
  annotations: false,
  automations: false,
};

const ALL_PERSONAL_FEATURES_ENABLED: PersonalFeatures = {
  evaluations: true,
  datasets: true,
  annotations: true,
  automations: true,
};

type PersonalWorkspaceOptions = {
  repository: OrganizationRepository;
  identities: PersonalWorkspaceIdentityPort;
  grants: AuthzApi;
  diagnostics: PersonalWorkspaceDiagnosticsPort | undefined;
};

export class PersonalWorkspaceService {
  static create(deps: PersonalWorkspaceOptions): PersonalWorkspaceService {
    return new PersonalWorkspaceService(deps);
  }

  private constructor(private readonly deps: PersonalWorkspaceOptions) {}

  async ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace> {
    const parsed = personalWorkspaceInputSchema.parse(input);
    const resources = this.deps.identities.create(parsed);
    const result = await this.deps.repository.ensurePersonalWorkspace({
      workspace: parsed,
      resources,
    });
    const grant = {
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      teamId: result.workspace.team.id,
    };
    try {
      await this.deps.grants.attachBindings({
        organizationId: grant.organizationId,
        bindings: [
          {
            bindingId: resources.ownerBindingId,
            principal: { userId: grant.userId },
            role: "ADMIN",
            customRoleId: null,
            scopeType: "TEAM",
            scopeId: grant.teamId,
          },
        ],
        actor: { type: "system", id: SYSTEM_ACTORS.personalWorkspace },
        source: "grants-service",
        onDuplicate: "skip",
        awaitProjection: false,
      });
    } catch (error) {
      if (!(error instanceof AuthzLedgerUnavailableError)) {
        throw error;
      }

      this.deps.diagnostics?.warn(
        "Personal workspace owner grant could not append; the next ensure retries",
        grant,
      );
    }

    return { ...result.workspace, created: result.created };
  }

  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.deps.repository.tryFindPersonalWorkspace(
      findPersonalWorkspaceInputSchema.parse(input),
    );
  }

  async getPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    const project = await this.getOwnedPersonalWorkspaceProject(input);

    return readPersonalFeatures(project.personalFeatures);
  }

  enableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.setPersonalWorkspaceFeatures(
      input,
      ALL_PERSONAL_FEATURES_ENABLED,
      "personalWorkspaceFeatures.enableAll",
    );
  }

  disableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.setPersonalWorkspaceFeatures(
      input,
      ALL_PERSONAL_FEATURES_DISABLED,
      "personalWorkspaceFeatures.disableAll",
    );
  }

  private async setPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
    next: PersonalFeatures,
    action: string,
  ): Promise<PersonalFeatures> {
    const project = await this.getOwnedPersonalWorkspaceProject(input);
    await this.deps.repository.setPersonalWorkspaceFeaturesWithAudit({
      projectId: project.id,
      callerUserId: input.callerUserId,
      organizationId: project.organizationId,
      action,
      before: readPersonalFeatures(project.personalFeatures),
      after: next,
    });

    return next;
  }

  private async getOwnedPersonalWorkspaceProject(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalWorkspaceFeatureProject> {
    const parsed = personalWorkspaceFeaturesInputSchema.parse(input);
    const project = await this.deps.repository.getPersonalWorkspaceFeatureProject(parsed.projectId);
    if (!project.isPersonal || project.ownerUserId !== parsed.callerUserId) {
      throw new PersonalProjectOwnerMismatchError();
    }

    return project;
  }
}
