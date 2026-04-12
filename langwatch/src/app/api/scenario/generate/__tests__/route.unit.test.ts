import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateObject } from "ai";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("../../../../../server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("../../../../../server/api/rbac", () => ({
  hasProjectPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../../../server/db", () => ({
  prisma: {},
}));

vi.mock("../../../../../server/modelProviders/utils", () => ({
  getVercelAIModel: vi.fn().mockResolvedValue({ modelId: "test-model" }),
}));

vi.mock("../../../../../utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { POST } from "../route";

function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/scenario/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/scenario/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when generating a scenario", () => {
    it("calls generateObject with mode 'tool' for cross-provider compatibility", async () => {
      const mockResult = {
        object: {
          name: "Test Scenario",
          situation: "A test situation",
          criteria: ["criterion 1"],
        },
      };

      (generateObject as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResult
      );

      await POST(
        createRequest({
          prompt: "Generate a test scenario",
          currentScenario: null,
          projectId: "project-123",
        }) as never
      );

      expect(generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "tool",
        })
      );
    });
  });
});
