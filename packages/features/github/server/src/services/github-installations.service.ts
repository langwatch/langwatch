import {
  GithubInstallationConflictError,
  type GithubRepositoryRef,
  type GithubTurnToken,
} from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";

import type { GithubAppTokenPort } from "../ports/github-app-token.port";
import type {
  GithubInstallationRow,
  GithubInstallationsRepository,
} from "../repositories/github-installations.repository";
import type { GithubInstallationAccessService } from "./github-installation-access.service";

const logger = createLogger("langwatch:github:installations");

export type GithubWebhookAction =
  | "created"
  | "deleted"
  | "suspend"
  | "unsuspend"
  | "added"
  | "removed";

export class GithubInstallationsService {
  static create(
    repository: GithubInstallationsRepository,
    appTokens: GithubAppTokenPort,
    organization: OrganizationService,
    access: GithubInstallationAccessService,
  ): GithubInstallationsService {
    return new GithubInstallationsService(repository, appTokens, organization, access);
  }

  private constructor(
    private readonly repository: GithubInstallationsRepository,
    private readonly appTokens: GithubAppTokenPort,
    private readonly organization: OrganizationService,
    private readonly access: GithubInstallationAccessService,
  ) {}

  get configured(): boolean {
    return this.appTokens.configured;
  }

  isOrganizationMember(input: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.organization.isMember(input);
  }

  getAllForOrganization(organizationId: string): Promise<GithubInstallationRow[]> {
    return this.repository.findAllForOrganization(organizationId);
  }

  // This read attributes a verified webhook and remains valid without credentials.
  tryGetByInstallationId(installationId: string): Promise<GithubInstallationRow | null> {
    return this.repository.tryFindByInstallationId(installationId);
  }

  async recordInstallation(input: {
    installationId: string;
    organizationId: string;
  }): Promise<{ accountLogin: string }> {
    const details = await this.appTokens.getInstallation(input.installationId);
    const repositories = await this.tryReadSelectedRepositories(details);
    const record = {
      installationId: details.installationId,
      organizationId: input.organizationId,
      accountLogin: details.accountLogin,
      accountType: details.accountType,
      accountId: details.accountId,
      repositorySelection: details.repositorySelection,
      repositories,
    };

    // The unique insert is the cross-tenant setup race boundary.
    const { wasInserted, row } = await this.repository.insertOrGetExisting(record);
    if (!wasInserted && row.organizationId !== input.organizationId) {
      throw new GithubInstallationConflictError({
        installationId: details.installationId,
        existingOrganizationId: row.organizationId,
        attemptedOrganizationId: input.organizationId,
      });
    }
    if (!wasInserted) {
      await this.repository.upsert(record);
    }

    return { accountLogin: details.accountLogin };
  }

  async handleWebhookEvent(input: {
    action: GithubWebhookAction;
    installationId: string;
    repositorySelection?: string;
    repositories?: GithubRepositoryRef[] | null;
  }): Promise<void> {
    switch (input.action) {
      case "deleted":
        await this.repository.deleteByInstallationId(input.installationId);
        return;
      case "suspend":
        await this.repository.setSuspended({
          installationId: input.installationId,
          suspended: true,
        });
        return;
      case "unsuspend":
        await this.repository.setSuspended({
          installationId: input.installationId,
          suspended: false,
        });
        return;
      case "created":
      case "added":
      case "removed":
        await this.refreshRepositories(input.installationId, input.action);
    }
  }

  listRepositoriesForOrganization(
    organizationId: string,
  ): Promise<GithubRepositoryRef[]> {
    return this.access.listRepositoriesForOrganization(organizationId);
  }

  tryResolveInstallationForRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<{ installationId: string; repositoryId: string } | null> {
    return this.access.tryResolveInstallationForRepository(input);
  }

  coversRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<boolean> {
    return this.access.coversRepository(input);
  }

  tryMintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null> {
    return this.access.tryMintTurnToken(input);
  }

  private async tryReadSelectedRepositories(details: {
    installationId: string;
    repositorySelection: string;
  }): Promise<GithubRepositoryRef[] | null> {
    if (details.repositorySelection !== "selected") {
      return null;
    }

    try {
      return await this.appTokens.listInstallationRepositories(details.installationId);
    } catch (error) {
      logger.warn(
        { error, installationId: details.installationId },
        "failed to cache selected repositories",
      );
      return null;
    }
  }

  private async refreshRepositories(
    installationId: string,
    action: GithubWebhookAction,
  ): Promise<void> {
    const existing = await this.repository.tryFindByInstallationId(installationId);
    if (!existing) {
      return;
    }

    try {
      const details = await this.appTokens.getInstallation(installationId);
      const repositories = await this.tryReadSelectedRepositories(details);
      await this.repository.setRepositories({
        installationId,
        repositorySelection: details.repositorySelection,
        repositories,
      });
    } catch (error) {
      logger.warn(
        { error, installationId, action },
        "failed to refresh webhook repositories",
      );
    }
  }
}
