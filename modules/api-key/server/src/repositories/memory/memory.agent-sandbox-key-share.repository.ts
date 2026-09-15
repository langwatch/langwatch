import { AgentSandboxKeyShareRepository } from "../agent-sandbox-key-share.repository.ts";

// Named rather than an inline object so the composition root's decision — no
// encryption key, no share — reads as a choice at the seam it was made.

/**
 * No share at all, for a deployment with no key to seal one with. The
 * plaintext token is the whole value of a share, so a process that cannot seal
 * it holds none and every run mints its own key.
 */
export class AbsentAgentSandboxKeyShareAdapter extends AgentSandboxKeyShareRepository {
  static create(): AbsentAgentSandboxKeyShareAdapter {
    return new AbsentAgentSandboxKeyShareAdapter();
  }

  async findSharedKey(): Promise<string | undefined> {
    return undefined;
  }

  async hold(): Promise<void> {
    return undefined;
  }
}
