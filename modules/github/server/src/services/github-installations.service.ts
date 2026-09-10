import {
  GithubInstallationAccountMismatchError,
  GithubInstallationConflictError,
  GithubInstallationNotFromFlowError,
  type GithubInstallation,
  type GithubRepositoryRef,
  type GithubTurnToken,
} from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { GithubAppTokenPort } from "../ports/github-app-token.port.ts";
import type {
  GithubInstallationRow,
  GithubInstallationsRepository,
} from "../repositories/github-installations.repository.ts";
import type { GithubInstallationAccessService } from "./github-installation-access.service.ts";
import { toDate, toEpochMs } from "@langwatch/time";

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
    organization: OrganizationApi,
    access: GithubInstallationAccessService,
  ): GithubInstallationsService {
    return new GithubInstallationsService(repository, appTokens, organization, access);
  }

  private constructor(
    private readonly repository: GithubInstallationsRepository,
    private readonly appTokens: GithubAppTokenPort,
    private readonly organization: OrganizationApi,
    private readonly access: GithubInstallationAccessService,
  ) {}

  get configured(): boolean {
    return this.appTokens.configured;
  }

  isOrganizationMember(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.organization.isMember(input);
  }

  async getAllForOrganization(organizationId: string): Promise<GithubInstallation[]> {
    const rows = await this.repository.findAllForOrganization(organizationId);

    return rows.map(toContractInstallation);
  }

  // This read attributes a verified webhook and remains valid without
  // credentials. It goes through the access service because branch mapping
  // reads it there too, and one row should have one reader.
  async findByInstallationId(installationId: string): Promise<GithubInstallation | null> {
    const row = await this.access.findByInstallationId(installationId);

    return row ? toContractInstallation(row) : null;
  }

  /**
   * Binds an installation to the organization whose flow produced it. `flowStartedAt` is the
   * signed state's issue time; `expectedAccountLogin` and `expectedInstallationId` are what
   * the flow recorded about which installation it is coming back for.
   */
  async recordInstallation(input: {
    installationId: string;
    organizationId: string;
    flowStartedAt: number;
    expectedAccountLogin?: string | undefined;
    expectedInstallationId?: string | undefined;
  }): Promise<{ accountLogin: string }> {
    const details = await this.appTokens.getInstallation(input.installationId);
    assertInstallationMatchesFlow({
      details,
      organizationId: input.organizationId,
      expectedAccountLogin: input.expectedAccountLogin,
      expectedInstallationId: input.expectedInstallationId,
    });
    const alreadyRecorded = await this.repository.tryFindByInstallationId(details.installationId);
    if (!alreadyRecorded && !installationBelongsToFlow(details.createdAt, input.flowStartedAt)) {
      throw new GithubInstallationNotFromFlowError({
        installationId: details.installationId,
        attemptedOrganizationId: input.organizationId,
      });
    }

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

  listRepositoriesForOrganization(organizationId: string): Promise<GithubRepositoryRef[]> {
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
      logger.warn({ error, installationId, action }, "failed to refresh webhook repositories");
    }
  }
}

/**
 * Whom GitHub says the installation belongs to, against whom the flow said it would.
 * The App JWT reads every installation of this App on every account, so the account
 * GitHub reports is the ownership evidence the callback has; a mismatch is refused.
 */
function assertInstallationMatchesFlow(input: {
  details: { installationId: string; accountLogin: string; accountId: string };
  organizationId: string;
  expectedAccountLogin: string | undefined;
  expectedInstallationId: string | undefined;
}): void {
  const { details } = input;
  const wrongInstallation =
    input.expectedInstallationId !== void 0 &&
    input.expectedInstallationId !== details.installationId;
  const wrongAccount =
    input.expectedAccountLogin !== void 0 &&
    !accountsMatch(input.expectedAccountLogin, details.accountLogin, details.accountId);
  if (wrongInstallation || wrongAccount) {
    throw new GithubInstallationAccountMismatchError({
      installationId: details.installationId,
      attemptedOrganizationId: input.organizationId,
    });
  }
}

/** GitHub logins are case-insensitive; the numeric account id is accepted too. */
function accountsMatch(expected: string, accountLogin: string, accountId: string): boolean {
  return expected.toLowerCase() === accountLogin.toLowerCase() || expected === accountId;
}

/** Clock skew allowed between GitHub's creation stamp and our own state. */
const INSTALLATION_CREATION_SKEW_MS = 60_000;

/** One stored installation, as the contract carries it: instants become the wire's dates. */
function toContractInstallation(row: GithubInstallationRow): GithubInstallation {
  return {
    ...row,
    suspendedAt: row.suspendedAt && toDate(row.suspendedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

/**
 * Whether GitHub's creation stamp puts the installation inside this flow. An installation
 * GitHub declines to date cannot be shown to belong to the flow, so it is refused: the whole
 * point is that an unproven claim fails.
 */
function installationBelongsToFlow(createdAt: string | null, flowStartedAt: number): boolean {
  if (!createdAt) {
    return false;
  }

  const created = toEpochMs(createdAt);
  if (Number.isNaN(created)) {
    return false;
  }

  return created >= flowStartedAt - INSTALLATION_CREATION_SKEW_MS;
}
