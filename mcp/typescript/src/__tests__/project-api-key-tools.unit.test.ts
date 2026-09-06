import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api-projects.js", () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
}));

vi.mock("../langwatch-api-api-keys.js", () => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  archiveProject,
} from "../langwatch-api-projects.js";

import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from "../langwatch-api-api-keys.js";

import { handleListProjects } from "../tools/list-projects.js";
import { handleGetProject } from "../tools/get-project.js";
import { handleCreateProject } from "../tools/create-project.js";
import { handleUpdateProject } from "../tools/update-project.js";
import { handleArchiveProject } from "../tools/archive-project.js";
import { handleListApiKeys } from "../tools/list-api-keys.js";
import { handleCreateApiKey } from "../tools/create-api-key.js";
import { handleRevokeApiKey } from "../tools/revoke-api-key.js";

const mockListProjects = vi.mocked(listProjects);
const mockGetProject = vi.mocked(getProject);
const mockCreateProject = vi.mocked(createProject);
const mockUpdateProject = vi.mocked(updateProject);
const mockArchiveProject = vi.mocked(archiveProject);
const mockListApiKeys = vi.mocked(listApiKeys);
const mockCreateApiKey = vi.mocked(createApiKey);
const mockRevokeApiKey = vi.mocked(revokeApiKey);

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Project Tools ---

describe("handleListProjects()", () => {
  const sampleProjects = [
    {
      id: "proj_abc123",
      name: "My Project",
      slug: "my-project",
      language: "python",
      framework: "openai",
      teamId: "team_1",
      piiRedactionLevel: "ESSENTIAL",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-06-01T00:00:00Z",
    },
    {
      id: "proj_def456",
      name: "Another Project",
      slug: "another-project",
      language: "typescript",
      framework: "langchain",
      teamId: "team_1",
      piiRedactionLevel: "DISABLED",
      createdAt: "2024-02-01T00:00:00Z",
      updatedAt: "2024-07-01T00:00:00Z",
    },
  ];

  describe("when projects exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListProjects.mockResolvedValue({
        data: sampleProjects,
        pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
      });
      result = await handleListProjects();
    });

    it("includes project count", () => {
      expect(result).toContain("2 total");
    });

    it("includes project names", () => {
      expect(result).toContain("My Project");
      expect(result).toContain("Another Project");
    });

    it("includes project IDs", () => {
      expect(result).toContain("proj_abc123");
      expect(result).toContain("proj_def456");
    });

    it("includes language and framework", () => {
      expect(result).toContain("python");
      expect(result).toContain("openai");
    });
  });

  describe("when no projects exist", () => {
    it("returns empty state with tip", async () => {
      mockListProjects.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      });
      const result = await handleListProjects();
      expect(result).toContain("No projects found");
      expect(result).toContain("platform_create_project");
    });
  });

  describe("when paginated", () => {
    it("shows pagination hint", async () => {
      mockListProjects.mockResolvedValue({
        data: [sampleProjects[0]!],
        pagination: { page: 1, limit: 1, total: 5, totalPages: 5 },
      });
      const result = await handleListProjects({ limit: 1 });
      expect(result).toContain("page 1 of 5");
    });
  });
});

describe("handleGetProject()", () => {
  it("returns formatted project details", async () => {
    mockGetProject.mockResolvedValue({
      id: "proj_abc123",
      name: "My Project",
      slug: "my-project",
      language: "python",
      framework: "openai",
      teamId: "team_1",
      piiRedactionLevel: "ESSENTIAL",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-06-01T00:00:00Z",
    });

    const result = await handleGetProject({ id: "proj_abc123" });

    expect(result).toContain("My Project");
    expect(result).toContain("proj_abc123");
    expect(result).toContain("python");
    expect(result).toContain("ESSENTIAL");
  });
});

describe("handleCreateProject()", () => {
  it("returns project details with service API key", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj_new",
      name: "New Project",
      slug: "new-project",
      language: "typescript",
      framework: "custom",
      teamId: "team_1",
      piiRedactionLevel: "DISABLED",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      serviceApiKey: "lw_sk_abc123secret",
      serviceApiKeyId: "key_svc_1",
    });

    const result = await handleCreateProject({
      name: "New Project",
      language: "typescript",
      framework: "custom",
      newTeamName: "My Team",
    });

    expect(result).toContain("created successfully");
    expect(result).toContain("New Project");
    expect(result).toContain("proj_new");
    expect(result).toContain("lw_sk_abc123secret");
    expect(result).toContain("Save the service API key now");
  });
});

describe("handleUpdateProject()", () => {
  it("returns updated project details", async () => {
    mockUpdateProject.mockResolvedValue({
      id: "proj_abc123",
      name: "Renamed Project",
      slug: "my-project",
      language: "python",
      framework: "openai",
      teamId: "team_1",
      piiRedactionLevel: "STRICT",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-08-01T00:00:00Z",
    });

    const result = await handleUpdateProject({
      id: "proj_abc123",
      name: "Renamed Project",
      piiRedactionLevel: "STRICT",
    });

    expect(result).toContain("updated successfully");
    expect(result).toContain("Renamed Project");
    expect(result).toContain("STRICT");
  });
});

describe("handleArchiveProject()", () => {
  it("returns archive confirmation", async () => {
    mockArchiveProject.mockResolvedValue({
      id: "proj_abc123",
      name: "My Project",
      archivedAt: "2024-09-01T00:00:00Z",
    });

    const result = await handleArchiveProject({ id: "proj_abc123" });

    expect(result).toContain("archived successfully");
    expect(result).toContain("proj_abc123");
    expect(result).toContain("My Project");
  });
});

// --- API Key Tools ---

describe("handleListApiKeys()", () => {
  describe("when keys exist", () => {
    it("shows key metadata and status", async () => {
      mockListApiKeys.mockResolvedValue({
        data: [
          {
            id: "key_1",
            name: "Production Key",
            description: "Main production API key",
            createdAt: "2024-01-01T00:00:00Z",
            expiresAt: null,
            lastUsedAt: "2024-06-01T00:00:00Z",
            revokedAt: null,
            roleBindings: [
              { id: "rb_1", role: "ADMIN", scopeType: "PROJECT", scopeId: "proj_abc" },
            ],
          },
          {
            id: "key_2",
            name: "Revoked Key",
            description: null,
            createdAt: "2024-01-01T00:00:00Z",
            expiresAt: null,
            lastUsedAt: null,
            revokedAt: "2024-05-01T00:00:00Z",
            roleBindings: [],
          },
        ],
      });

      const result = await handleListApiKeys();

      expect(result).toContain("2 total");
      expect(result).toContain("Production Key");
      expect(result).toContain("ACTIVE");
      expect(result).toContain("Revoked Key");
      expect(result).toContain("REVOKED");
      expect(result).toContain("ADMIN on PROJECT:proj_abc");
    });
  });

  describe("when no keys exist", () => {
    it("returns empty state with tip", async () => {
      mockListApiKeys.mockResolvedValue({ data: [] });

      const result = await handleListApiKeys();

      expect(result).toContain("No API keys found");
      expect(result).toContain("platform_create_api_key");
    });
  });
});

describe("handleCreateApiKey()", () => {
  it("returns token with save warning", async () => {
    mockCreateApiKey.mockResolvedValue({
      token: "lw_pat_secret_token_123",
      apiKey: {
        id: "key_new",
        name: "My New Key",
        createdAt: "2024-01-01T00:00:00Z",
      },
    });

    const result = await handleCreateApiKey({
      keyType: "personal",
      name: "My New Key",
      bindings: [
        { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org_1" },
      ],
    });

    expect(result).toContain("created successfully");
    expect(result).toContain("My New Key");
    expect(result).toContain("lw_pat_secret_token_123");
    expect(result).toContain("Save this token now");
  });
});

describe("handleRevokeApiKey()", () => {
  it("confirms revocation", async () => {
    mockRevokeApiKey.mockResolvedValue({ success: true });

    const result = await handleRevokeApiKey({ id: "key_123" });

    expect(result).toContain("key_123");
    expect(result).toContain("revoked successfully");
  });
});

// --- Error-path tests ---

describe("handleCreateProject() validation", () => {
  describe("when neither teamId nor newTeamName is provided", () => {
    it("returns a validation error without calling the API", async () => {
      const result = await handleCreateProject({
        name: "Test Project",
        language: "python",
        framework: "openai",
      });

      expect(result).toContain("Error");
      expect(result).toContain("teamId");
      expect(result).toContain("newTeamName");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });
  });

  describe("when API does not return a serviceApiKey", () => {
    it("throws an error to prevent silent data loss", async () => {
      mockCreateProject.mockResolvedValue({
        id: "proj_new",
        name: "New Project",
        slug: "new-project",
        language: "typescript",
        framework: "custom",
        teamId: "team_1",
        piiRedactionLevel: "DISABLED",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        serviceApiKey: "",
        serviceApiKeyId: "key_svc_1",
      } as never);

      await expect(
        handleCreateProject({
          name: "New Project",
          language: "typescript",
          framework: "custom",
          newTeamName: "My Team",
        }),
      ).rejects.toThrow("service API key");
    });
  });
});

describe("handleListProjects() edge cases", () => {
  describe("when API returns non-array data", () => {
    it("returns empty state message", async () => {
      mockListProjects.mockResolvedValue({
        data: null as never,
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      });

      const result = await handleListProjects();

      expect(result).toContain("No projects found");
    });
  });

  describe("when API call throws", () => {
    it("propagates the error", async () => {
      mockListProjects.mockRejectedValue(
        new Error('LangWatch API error 403: {"error":"Forbidden","message":"Insufficient permissions"}'),
      );

      await expect(handleListProjects()).rejects.toThrow("403");
    });
  });
});

describe("handleListApiKeys() edge cases", () => {
  describe("when a key has a past expiration date", () => {
    it("shows EXPIRED status", async () => {
      mockListApiKeys.mockResolvedValue({
        data: [
          {
            id: "key_exp",
            name: "Expired Key",
            description: null,
            createdAt: "2024-01-01T00:00:00Z",
            expiresAt: "2024-06-01T00:00:00Z",
            lastUsedAt: null,
            revokedAt: null,
            roleBindings: [],
          },
        ],
      });

      const result = await handleListApiKeys();

      expect(result).toContain("EXPIRED");
    });
  });

  describe("when a key has a future expiration date", () => {
    it("shows ACTIVE status", async () => {
      mockListApiKeys.mockResolvedValue({
        data: [
          {
            id: "key_future",
            name: "Future Key",
            description: null,
            createdAt: "2024-01-01T00:00:00Z",
            expiresAt: "2099-12-31T23:59:59Z",
            lastUsedAt: null,
            revokedAt: null,
            roleBindings: [],
          },
        ],
      });

      const result = await handleListApiKeys();

      expect(result).toContain("ACTIVE");
    });
  });

  describe("when API returns non-array data", () => {
    it("returns empty state message", async () => {
      mockListApiKeys.mockResolvedValue({ data: null as never });

      const result = await handleListApiKeys();

      expect(result).toContain("No API keys found");
    });
  });
});
