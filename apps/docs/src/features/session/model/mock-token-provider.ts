import type { DocsSessionToken, DocsTokenProvider } from "./token-provider.ts";
import { DocsSessionError } from "./token-provider.ts";

export class MockDocsTokenProvider implements DocsTokenProvider {
  readonly kind = "mock";
  #now: () => number;
  #sequence = 0;
  #activeGrant: string | null = null;

  private constructor({ now }: { now: () => number }) {
    this.#now = now;
  }

  static create({ now = Date.now }: { now?: () => number } = {}) {
    return new MockDocsTokenProvider({ now });
  }

  async acquire({ signal }: { signal: AbortSignal }): Promise<DocsSessionToken> {
    if (signal.aborted)
      throw new DocsSessionError({ code: "cancelled", message: "Connection cancelled." });
    this.#sequence += 1;
    this.#activeGrant = `demo-grant-${this.#sequence}`;
    return {
      token: `docs-demo-not-a-credential-${this.#sequence}`,
      grantId: this.#activeGrant,
      projectId: "docs-demo-project",
      projectName: "Docs demo project",
      apiOrigin: "https://app.langwatch.ai",
      expiresAt: this.#now() + 60_000,
      purpose: "docs-playground",
      permissions: ["traces:view"],
    };
  }

  async revoke({ grantId }: { grantId: string }): Promise<void> {
    if (this.#activeGrant === grantId) this.#activeGrant = null;
  }
}
