/**
 * @vitest-environment node
 * @see modules/hosted-mcp/specs/hosted-mcp.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type {
  McpOAuthClientRepository,
  RegisteredOAuthClient,
} from "../../repositories/mcp-oauth-client.repository.ts";
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

describe("given a registered client approving a project that holds no credential", () => {
  const redirectUri = "https://client.example/callback";
  const serviceFor = ({
    kind,
    storeAuthorizationCode,
  }: {
    kind: string;
    storeAuthorizationCode: () => Promise<void>;
  }) =>
    McpAuthorizationService.create({
      collaborators: createApiFixture<McpAuthorizationCollaborators>({
        clients: createApiFixture<McpOAuthClientRepository>({
          getByClientId: async () => ({
            kind: "registered",
            client: createApiFixture<RegisteredOAuthClient>({ redirectUris: [redirectUri] }),
          }),
        }),
        codes: createApiFixture<McpOAuthTokenRepository>({
          isAvailable: () => true,
          storeAuthorizationCode,
        }),
        isDemoProject: () => false,
        findProject: async () => ({
          id: "project-1",
          organizationId: "org-1",
          kind,
          archivedAt: null,
        }),
        mayApprove: async () => true,
      }),
    });
  const approve = (service: McpAuthorizationService) =>
    service.authorize({
      approverId: "user-1",
      impersonatorId: undefined,
      raw: JSON.stringify({
        projectId: "project-1",
        client_id: "client-1",
        redirect_uri: redirectUri,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        state: "s-1",
      }),
    });

  it("refuses an aggregate with access_denied and its registered code, minting no code", async () => {
    const storeAuthorizationCode = vi.fn(async () => undefined);

    const answer = await approve(serviceFor({ kind: "aggregate", storeAuthorizationCode }));

    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({
      error: "access_denied",
      code: "aggregate_project_has_no_credential",
    });
    const redirect = new URL("redirect" in answer.body ? (answer.body.redirect ?? "") : "");
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.has("code")).toBe(false);
    expect(storeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("refuses the hidden governance project as plainly not reachable", async () => {
    const storeAuthorizationCode = vi.fn(async () => undefined);

    const answer = await approve(
      serviceFor({ kind: "internal_governance", storeAuthorizationCode }),
    );

    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ error: "access_denied" });
    expect(answer.body).not.toHaveProperty("code");
    expect(storeAuthorizationCode).not.toHaveBeenCalled();
  });
});
