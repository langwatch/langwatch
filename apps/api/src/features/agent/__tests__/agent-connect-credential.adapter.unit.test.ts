/**
 * The credential check a connected-agent session (socket or HTTP) runs before anything
 * else: which kinds of API key may connect, which permission they need, and how an
 * @see specs/agents/connected-agents.feature
 */
import { AgentRegisterRefusedError } from "@langwatch/agent-contract";
import type { ApiKeyService, ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

class ForbiddenTestError extends HandledError {
  constructor() {
    super("forbidden", "forbidden", { httpStatus: 403 });
  }
}
import { ApiConnectCredentialAdapter } from "../agent-connect-credential.adapter";
import type { ApiHandlerManagedCredentials } from "../../../app/api-handler-managed-credential";

function apiKeyToken(overrides: Partial<ResolvedApiKeyToken> = {}): ResolvedApiKeyToken {
  return {
    type: "apiKey",
    apiKeyId: "apikey_1",
    userId: "user_1",
    organizationId: "org_1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    isLangySessionKey: false,
    project: { id: "project_1", slug: "project-1" },
    ...overrides,
  } as ResolvedApiKeyToken;
}

function build({
  resolved = null,
  org = { ok: false as const, reason: "wrong_credential_class" as const },
  ceilingRefuses = false,
}: {
  resolved?: ResolvedApiKeyToken | null;
  org?: Awaited<ReturnType<ApiKeyService["resolveOrganizationToken"]>>;
  ceilingRefuses?: boolean;
}) {
  const apiKeys = {
    tryResolveToken: vi.fn().mockResolvedValue(resolved),
    resolveOrganizationToken: vi.fn().mockResolvedValue(org),
  } as unknown as ApiKeyService;
  const credentials = {
    enforceCeiling: vi.fn().mockImplementation(async () => {
      if (ceilingRefuses) {
        throw new ForbiddenTestError();
      }
    }),
  } as unknown as ApiHandlerManagedCredentials;
  const projectsReachableBy = vi.fn().mockResolvedValue([{ id: "project_1", name: "Project One" }]);
  const adapter = ApiConnectCredentialAdapter.create({
    apiKeys,
    credentials,
    projectsReachableBy,
  });
  return { adapter, apiKeys, credentials, projectsReachableBy };
}

describe("ApiConnectCredentialAdapter", () => {
  describe("given an ingestion key of the project", () => {
    /** @scenario "An ingestion key cannot connect" */
    it("refuses the connection with key_type_not_allowed", async () => {
      const { adapter } = build({
        resolved: apiKeyToken({ ingestionTemplateId: "template_1" }),
      });

      const failure = await adapter
        .resolve({ token: "ik-lw-anything", projectId: "project_1" })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentRegisterRefusedError);
      expect((failure as AgentRegisterRefusedError).meta.reason).toBe("key_type_not_allowed");
    });
  });

  describe("given a Langy session key of the project", () => {
    /** @scenario "A Langy session key cannot connect" */
    it("refuses the connection with key_type_not_allowed", async () => {
      const { adapter } = build({
        resolved: apiKeyToken({ isLangySessionKey: true }),
      });

      const failure = await adapter
        .resolve({ token: "sk-lw-anything", projectId: "project_1" })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentRegisterRefusedError);
      expect((failure as AgentRegisterRefusedError).meta.reason).toBe("key_type_not_allowed");
    });
  });

  describe("given a personal key that holds only scenarios:view", () => {
    /** @scenario "A key without scenarios manage cannot connect" */
    it("refuses the connection with permission_denied", async () => {
      const { adapter } = build({
        resolved: apiKeyToken(),
        ceilingRefuses: true,
      });

      const failure = await adapter
        .resolve({ token: "sk-lw-anything", projectId: "project_1" })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentRegisterRefusedError);
      expect((failure as AgentRegisterRefusedError).meta.reason).toBe("permission_denied");
    });
  });

  describe("given an organization key bound to several projects", () => {
    /** @scenario "A key that reaches several projects must name one" */
    it("refuses without an X-Project-Id header and lists the reachable projects", async () => {
      const { adapter, projectsReachableBy } = build({
        resolved: null,
        org: {
          ok: true,
          resolved: {
            type: "apiKey-org",
            apiKeyId: "apikey_org",
            userId: null,
            organizationId: "org_1",
          },
        },
      });

      const failure = await adapter
        .resolve({ token: "sk-lw-org", projectId: null })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentRegisterRefusedError);
      const refused = failure as AgentRegisterRefusedError;
      expect(refused.meta.reason).toBe("project_required");
      expect(refused.meta.projects).toEqual([{ id: "project_1", name: "Project One" }]);
      expect(projectsReachableBy).toHaveBeenCalledWith("org_1");
    });
  });

  describe("given a token that names no key", () => {
    /** @scenario "An invalid key cannot connect" */
    it("refuses the connection with api_key_invalid", async () => {
      const { adapter } = build({ resolved: null });

      const failure = await adapter
        .resolve({ token: "sk-lw-nope", projectId: "project_1" })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentRegisterRefusedError);
      expect((failure as AgentRegisterRefusedError).meta.reason).toBe("api_key_invalid");
    });
  });
});
