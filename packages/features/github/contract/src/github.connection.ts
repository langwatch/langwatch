/**
 * The organization's view of its GitHub connection: what a settings surface
 * renders, and what a disconnect hands back.
 *
 * Deliberately narrower than `GithubInstallation`: a member who can see that a
 * connection exists is not shown the repository names it reaches, only how
 * many of them a "selected" install covers.
 */
export type GithubInstallationSummary = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  /** Known only for a "selected" install; "all" resolves live. */
  repositoryCount: number | null;
  suspended: boolean;
  /** GitHub can only be uninstalled on GitHub, so this deep-links there. */
  uninstallUrl: string;
};

export type GithubConnectionStatus = {
  /** Whether this instance can start an installation at all. */
  configured: boolean;
  connected: boolean;
  installations: GithubInstallationSummary[];
  /** Where an install starts, or null on an instance that cannot start one. */
  installUrl: string | null;
};

/**
 * GitHub cannot be uninstalled through the API, so disconnecting hands back
 * the deep link a human follows; the webhook removes the local row once
 * GitHub confirms.
 */
export type GithubDisconnectResult = {
  uninstallUrl: string;
};
