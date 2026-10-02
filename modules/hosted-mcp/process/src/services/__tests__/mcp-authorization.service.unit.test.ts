/**
 * @vitest-environment node
 * @see modules/hosted-mcp/specs/hosted-mcp.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { McpOAuthClientRepository } from "../../repositories/mcp-oauth-client.repository.ts";
import type { McpOAuthTokenRepository } from "../../repositories/mcp-oauth-token.repository.ts";
import {
  type McpAuthorizationCollaborators,
  McpAuthorizationService,
} from "../mcp-authorization.service.ts";

describe("given an operator acting as a member on the consent page", () => {
  /** @scenario "An MCP authorization code is not issued while an operator acts as another member" */
  it("refuses with access_denied before any client, project or code is reached", async () => {
    const service = McpAuthorizationService.create({
      collaborators: createApiFixture<McpAuthorizationCollaborators>({
        clients: createApiFixture<McpOAuthClientRepository>(),
        codes: createApiFixture<McpOAuthTokenRepository>(),
      }),
    });

    const answer = await service.authorize({
      approverId: "user-1",
      impersonatorId: "operator-1",
      raw: JSON.stringify({
        project_id: "project-1",
        client_id: "client-1",
        redirect_uri: "https://client.example/callback",
        code_challenge: "challenge",
        code_challenge_method: "S256",
      }),
    });

    expect(answer).toEqual({ status: 403, body: { error: "access_denied" } });
  });
});
