import {
  GithubApiRateLimitedError,
  GithubInstallationSuspendedError,
  type GithubRepositoryRef,
  type GithubTurnToken,
} from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";

import {
  type GithubAppTokenPort,
  GithubInstallationNotFoundError,
  GithubRateLimitedError,
} from "../ports/github-app-token.port";
import type {
  GithubInstallationRow,
  GithubInstallationsRepository,
} from "../repositories/github-installations.repository";

const logger = createLogger("langwatch:github:installation-access");

type RepositoryResolution = {
  repoId: string | null;
  wasDeadInstallation: boolean;
};

type MintOutcome = {
  token: GithubTurnToken | null;
  wasDeadInstallation: boolean;
};

export class GithubInstallationAccessService {
  static create(
    repository: GithubInstallationsRepository,
    appTokens: GithubAppTokenPort,
  ): GithubInstallationAccessService {
    return new GithubInstallationAccessService(repository, appTokens);
  }

  private constructor(
    private readonly repository: GithubInstallationsRepository,
    private readonly appTokens: GithubAppTokenPort,
  ) {}

  async listRepositoriesForOrganization(
    organizationId: string,
  ): Promise<GithubRepositoryRef[]> {
    const installations = await this.repository.findAllForOrganization(organizationId);
    const usable = installations.filter((installation) => !installation.suspendedAt);
    if (installations.length > 0 && usable.length === 0) {
      throw new GithubInstallationSuspendedError({
        accountLogin: installations[0]!.accountLogin,
      });
    }

    const repositories: GithubRepositoryRef[] = [];
    const seen = new Set<string>();
    for (const installation of usable) {
      const visible = await this.tryListRepositories(installation.installationId);
      for (const repository of visible) {
        if (seen.has(repository.fullName)) {
          continue;
        }

        seen.add(repository.fullName);
        repositories.push(repository);
      }
    }

    return repositories;
  }

  async tryResolveInstallationForRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<{ installationId: string; repositoryId: string } | null> {
    if (!this.appTokens.configured) {
      return null;
    }

    const installations = await this.usableInstallations(input.organizationId);
    for (const installation of installations) {
      const resolved = await this.resolveRepositoryIdOrHeal(
        installation,
        input.repositoryFullName,
      );
      if (resolved.repoId) {
        return {
          installationId: installation.installationId,
          repositoryId: resolved.repoId,
        };
      }
    }

    return null;
  }

  async coversRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<boolean> {
    if (!this.appTokens.configured) {
      return false;
    }

    const wanted = input.repositoryFullName.toLowerCase();
    const owner = wanted.split("/")[0] ?? "";
    const installations = await this.usableInstallations(input.organizationId);

    return installations.some((installation) => {
      if (installation.repositorySelection === "all") {
        return installation.accountLogin.toLowerCase() === owner;
      }

      return (installation.repositories ?? []).some(
        (repository) => repository.fullName.toLowerCase() === wanted,
      );
    });
  }

  async tryMintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null> {
    if (!this.appTokens.configured) {
      return null;
    }

    const usable = await this.usableInstallations(input.organizationId);
    if (usable.length === 0) {
      return null;
    }

    return input.repositoryFullName
      ? this.mintForRepository(usable, input.repositoryFullName)
      : this.mintForAnyInstallation(usable);
  }

  private async usableInstallations(
    organizationId: string,
  ): Promise<GithubInstallationRow[]> {
    const installations = await this.repository.findAllForOrganization(organizationId);
    return installations.filter((installation) => !installation.suspendedAt);
  }

  private async tryListRepositories(
    installationId: string,
  ): Promise<GithubRepositoryRef[]> {
    try {
      return await this.appTokens.listInstallationRepositories(installationId);
    } catch (error) {
      if (error instanceof GithubRateLimitedError) {
        throw new GithubApiRateLimitedError(
          { retryAfterSec: error.retryAfterSec },
          { reasons: [error] },
        );
      }

      logger.warn({ error, installationId }, "failed to list installation repos");
      return [];
    }
  }

  private async mintForRepository(
    installations: GithubInstallationRow[],
    repositoryFullName: string,
  ): Promise<GithubTurnToken | null> {
    for (const installation of installations) {
      const resolved = await this.resolveRepositoryIdOrHeal(
        installation,
        repositoryFullName,
      );
      if (!resolved.repoId) {
        continue;
      }

      const outcome = await this.mintScoped({
        installationId: installation.installationId,
        repositoryIds: [resolved.repoId],
      });
      if (outcome.token) {
        return outcome.token;
      }
      if (!outcome.wasDeadInstallation) {
        return null;
      }
    }

    return null;
  }

  private async mintForAnyInstallation(
    installations: GithubInstallationRow[],
  ): Promise<GithubTurnToken | null> {
    for (const installation of installations) {
      const outcome = await this.mintScoped({
        installationId: installation.installationId,
      });
      if (outcome.token) {
        return outcome.token;
      }
      if (!outcome.wasDeadInstallation) {
        return null;
      }
    }

    return null;
  }

  private async mintScoped(input: {
    installationId: string;
    repositoryIds?: string[];
  }): Promise<MintOutcome> {
    try {
      const minted = await this.appTokens.mintInstallationToken({
        installationId: input.installationId,
        ...(input.repositoryIds ? { repositoryIds: input.repositoryIds } : {}),
      });

      return {
        token: {
          token: minted.token,
          repoScopeKey: this.appTokens.computeRepoScopeKey({
            repositoryIds: input.repositoryIds,
          }),
          installationId: input.installationId,
        },
        wasDeadInstallation: false,
      };
    } catch (error) {
      if (error instanceof GithubInstallationNotFoundError) {
        await this.markInstallationDead(input.installationId);
        return { token: null, wasDeadInstallation: true };
      }

      logger.warn(
        { error, installationId: input.installationId },
        "failed to mint installation token",
      );
      return { token: null, wasDeadInstallation: false };
    }
  }

  private async resolveRepositoryIdOrHeal(
    installation: GithubInstallationRow,
    repositoryFullName: string,
  ): Promise<RepositoryResolution> {
    try {
      const repoId = await this.resolveRepositoryId(installation, repositoryFullName);
      return { repoId, wasDeadInstallation: false };
    } catch (error) {
      if (!(error instanceof GithubInstallationNotFoundError)) {
        throw error;
      }

      await this.markInstallationDead(installation.installationId);
      return { repoId: null, wasDeadInstallation: true };
    }
  }

  private async resolveRepositoryId(
    installation: GithubInstallationRow,
    repositoryFullName: string,
  ): Promise<string | null> {
    const wanted = repositoryFullName.toLowerCase();
    const cached = installation.repositories?.find(
      (repository) => repository.fullName.toLowerCase() === wanted,
    );
    if (cached) {
      return cached.id;
    }

    try {
      const repositories = await this.appTokens.listInstallationRepositories(
        installation.installationId,
      );
      return (
        repositories.find((repository) => repository.fullName.toLowerCase() === wanted)
          ?.id ?? null
      );
    } catch (error) {
      if (error instanceof GithubInstallationNotFoundError) {
        throw error;
      }

      logger.warn(
        {
          error,
          installationId: installation.installationId,
          repositoryFullName,
        },
        "failed to resolve repository id",
      );
      return null;
    }
  }

  private async markInstallationDead(installationId: string): Promise<void> {
    logger.warn({ installationId }, "removing missing GitHub installation");
    await this.repository.deleteByInstallationId(installationId);
  }
}
