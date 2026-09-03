/**
 * The credential a connected-agent session authenticates with (ADR-128).
 *
 * Main's `AgentSessionCore.authenticate` read a project API key with
 * `TokenResolver`, refused an ingestion key or a Langy session key, enforced
 * `scenarios:manage`, and named the reachable projects of an org-scoped key
 * that named none. All four steps need `@langwatch/api-key-*`, which
 * `agent-server` may not depend on, so they live in the process's own
 * adapter; this port is the single call the session service makes, and the
 * adapter throws {@link AgentRegisterRefusedError} for every refusal so the
 * session service never has to know why.
 */

export interface ResolvedConnectCredential {
  project: { id: string; slug: string };
  /** Set for a personal API key; null for a project key. */
  userId: string | null;
}

export abstract class ConnectCredentialPort {
  /**
   * Resolves a bearer token to the project it may connect an agent to.
   *
   * @throws {AgentRegisterRefusedError} the key is invalid, of a kind that
   * may not connect, lacks `scenarios:manage`, or names no project among
   * several reachable ones.
   */
  abstract resolve(input: {
    token: string;
    projectId: string | null;
  }): Promise<ResolvedConnectCredential>;
}
