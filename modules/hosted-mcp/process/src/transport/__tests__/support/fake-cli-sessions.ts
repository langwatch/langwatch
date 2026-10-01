import { ValidationError } from "@langwatch/handled-error";

import type { McpCliSessions } from "../../../services/mcp-oauth-token.service.ts";

type Bound = Readonly<{ userId: string; organizationId: string; projectId: string }>;

/** The auth module's session store, in memory: tokens are lw_at_ / lw_rt_ and rotate on refresh. */
export class FakeCliSessions implements McpCliSessions {
  readonly access = new Map<string, Bound>();
  readonly refresh = new Map<string, Bound>();
  #counter = 0;

  issueProjectCliSession({
    userId,
    organizationId,
    projectId,
  }: Bound & { clientLabel: string }) {
    return Promise.resolve(this.#mint({ userId, organizationId, projectId }));
  }

  refreshCliSession({ refreshToken }: { refreshToken: string }) {
    const bound = this.refresh.get(refreshToken);
    if (!bound) return Promise.reject(new ValidationError("invalid_grant"));
    this.refresh.delete(refreshToken);
    return Promise.resolve(this.#mint(bound));
  }

  getCliAccessSession({ authorization }: { authorization: string }) {
    const token = authorization.replace(/^Bearer /, "");
    const bound = this.access.get(token);
    if (!bound) return Promise.reject(new ValidationError("invalid_credentials"));
    return Promise.resolve({ ...bound, tokenKey: `lwcli:access:${token}` });
  }

  /** Ends an access token the way its expiry does. */
  expire(accessToken: string): void {
    this.access.delete(accessToken);
  }

  #mint(bound: Bound) {
    const id = ++this.#counter;
    const accessToken = `lw_at_${id}`;
    const refreshToken = `lw_rt_${id}`;
    this.access.set(accessToken, bound);
    this.refresh.set(refreshToken, bound);
    return { accessToken, refreshToken, accessTtlSeconds: 3600, refreshTtlSeconds: 7776000 };
  }
}
