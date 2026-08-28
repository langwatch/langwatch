import type {
  GithubAppConfig,
  GithubConnectionStatus,
  GithubDisconnectResult,
  GithubInstallation,
  GithubInstallationSummary,
} from "@langwatch/github-contract";
import { GithubNotConnectedError } from "@langwatch/github-contract";

/**
 * What the connection service reads. Narrower than the installations service
 * on purpose: this one answers "what does the organization see, and where does
 * it go to change it", and nothing here writes.
 */
type GithubConnectionDependencies = {
  installations: {
    getAllForOrganization(organizationId: string): Promise<readonly GithubInstallation[]>;
    tryGetByInstallationId(installationId: string): Promise<GithubInstallation | null>;
  };
  getAppConfig(): GithubAppConfig;
  getWebBase(): string;
};

/**
 * The organization's GitHub connection as a surface reads and changes it.
 *
 * Reading the state is deliberately shallow — a member learns that a
 * connection exists and how wide it reaches, never which repositories it
 * names. Changing it cannot be done from here at all: GitHub only accepts an
 * uninstall from a human on GitHub, so disconnecting produces a deep link and
 * the webhook removes the local row once GitHub confirms.
 */
export class GithubConnectionService {
  static create(dependencies: GithubConnectionDependencies): GithubConnectionService {
    return new GithubConnectionService(dependencies);
  }

  private constructor(private readonly dependencies: GithubConnectionDependencies) {}

  async getConnectionStatus(input: { organizationId: string }): Promise<GithubConnectionStatus> {
    const installations = await this.dependencies.installations.getAllForOrganization(
      input.organizationId,
    );
    const webBase = this.dependencies.getWebBase();

    return {
      // The same reading `installUrl` takes, which includes the App slug the
      // deep link needs. Reporting token readiness here instead said GitHub
      // was available on an instance with no slug, while both install actions
      // were disabled, which is the state this contradiction produced on the
      // settings page.
      configured: this.configured,
      connected: installations.length > 0,
      installations: installations.map((installation) => this.summarise(installation, webBase)),
      installUrl: this.installUrl(input.organizationId),
    };
  }

  async disconnect(input: {
    organizationId: string;
    installationId: string;
  }): Promise<GithubDisconnectResult> {
    const installation = await this.dependencies.installations.tryGetByInstallationId(
      input.installationId,
    );
    // Cross-tenant guard: the installation must belong to this organization.
    // One owned by another organization is reported exactly as a missing one,
    // so the id cannot be probed.
    if (!installation || installation.organizationId !== input.organizationId) {
      throw new GithubNotConnectedError(input.organizationId);
    }

    return { uninstallUrl: this.uninstallUrl(installation, this.dependencies.getWebBase()) };
  }

  private get configured(): boolean {
    return this.dependencies.getAppConfig().configured;
  }

  private summarise(installation: GithubInstallation, webBase: string): GithubInstallationSummary {
    return {
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      // Known only for a "selected" install; "all" resolves live.
      repositoryCount:
        installation.repositorySelection === "selected"
          ? (installation.repositories?.length ?? 0)
          : null,
      suspended: installation.suspendedAt != null,
      uninstallUrl: this.uninstallUrl(installation, webBase),
    };
  }

  /**
   * GitHub can only be uninstalled by a human on GitHub itself. Deep-link to
   * the right account settings page on the host this instance is bound to.
   */
  private uninstallUrl(
    installation: Pick<GithubInstallation, "accountLogin" | "accountType" | "installationId">,
    webBase: string,
  ): string {
    if (installation.accountType === "Organization") {
      return `${webBase}/organizations/${installation.accountLogin}/settings/installations/${installation.installationId}`;
    }
    return `${webBase}/settings/installations/${installation.installationId}`;
  }

  /**
   * Where an install starts, or null on an instance that cannot start one.
   * Built here so no client needs to know the App slug, or that the flow
   * begins with a REST redirect at all.
   *
   * Null takes the same reading of "configured" the install route itself
   * takes, which includes the App slug the deep link is built from. Reading it
   * any other way hands the customer a button whose only possible outcome is
   * the route's 503.
   */
  private installUrl(organizationId: string): string | null {
    if (!this.configured) return null;
    return `/api/github/install?organizationId=${encodeURIComponent(organizationId)}`;
  }
}
