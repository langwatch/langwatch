// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Exchanging a source's stored credential for the bearer its provider calls need, outside a
 * scheduled pull. Throws `ProviderSignInError` naming why: fill it in, fix it, or try again.
 */
export interface ProviderSignInChannel {
  /** Databricks: a pasted workspace token, else the service principal's client credentials. */
  getWorkspaceToken(args: {
    credentials: Record<string, string> | undefined;
    workspaceUrl: string;
    signal?: AbortSignal;
  }): Promise<string>;
  /** Microsoft: the app registration's client credentials, scoped to one resource. */
  getEnvironmentToken(args: {
    credentials: Record<string, string> | undefined;
    environmentUrl: string;
    scope?: string;
    signal?: AbortSignal;
  }): Promise<string>;
}
