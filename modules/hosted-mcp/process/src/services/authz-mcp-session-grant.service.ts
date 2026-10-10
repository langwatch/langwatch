import type { AuthzApi } from "@langwatch/authz-contract";

import { MCP_AUTHORIZE_PERMISSION } from "./mcp-authorization.service.ts";

/**
 * Whether the person an MCP bearer was minted for still holds the grant the
 * approval step demanded, re-checked against the same permission it was
 * minted under.
 */
export class AuthzMcpSessionGrantService {
  readonly #authorization: AuthzApi;

  private constructor(authorization: AuthzApi) {
    this.#authorization = authorization;
  }

  static create({ authorization }: { authorization: AuthzApi }): AuthzMcpSessionGrantService {
    return new AuthzMcpSessionGrantService(authorization);
  }

  stillGranted(input: { userId: string; projectId: string }): Promise<boolean> {
    return this.#authorization.hasPermission({
      userId: input.userId,
      projectId: input.projectId,
      permission: MCP_AUTHORIZE_PERMISSION,
    });
  }
}
