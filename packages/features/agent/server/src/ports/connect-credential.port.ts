/**
 * The credential a connected-agent session authenticates with (ADR-128).
 */

export interface ResolvedConnectCredential {
  project: { id: string; slug: string };
  /** Set for a personal API key; null for a project key. */
  userId: string | null;
}

export abstract class ConnectCredentialPort {
  /**
   * Resolves a bearer token to the project it may connect an agent to.
   */
  abstract resolve(input: {
    token: string;
    projectId: string | null;
  }): Promise<ResolvedConnectCredential>;
}
