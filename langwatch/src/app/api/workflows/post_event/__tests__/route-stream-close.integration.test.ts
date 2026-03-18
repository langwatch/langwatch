import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock modules that depend on generated types (which don't exist in test env)
vi.mock("~/server/datasets/types", () => ({
  datasetColumnTypeSchema: z.string(),
}));

vi.mock("~/server/evaluations/evaluators.generated", () => ({}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/server/auth", () => ({
  authOptions: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn().mockImplementation((event: unknown) => event),
  getS3CacheKey: vi.fn(),
}));

vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: vi.fn().mockImplementation((event: unknown) => event),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../middleware/logger", () => ({
  loggerMiddleware: () => async (_c: any, next: any) => next(),
}));

vi.mock("../../../middleware/tracer", () => ({
  tracerMiddleware: () => async (_c: any, next: any) => next(),
}));

// The key mock: studioBackendPostEvent
const mockStudioBackendPostEvent = vi.fn();
vi.mock("../post-event", () => ({
  studioBackendPostEvent: (...args: unknown[]) =>
    mockStudioBackendPostEvent(...args),
}));

type OnEvent = (event: { type: string; payload?: unknown }) => void;

describe("POST /api/workflows/post_event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeRequest = async () => {
    const { POST } = await import("../route");

    const body = JSON.stringify({
      projectId: "project-1",
      event: { type: "is_alive", payload: {} },
    });

    const request = new Request("http://localhost/api/workflows/post_event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    return POST(request);
  };

  const readStreamToCompletion = async (
    response: Response,
  ): Promise<string> => {
    const reader = response.body!.getReader();
    const chunks: string[] = [];
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }

    return chunks.join("");
  };

  describe("when studioBackendPostEvent completes without a done event", () => {
    it("closes the SSE stream", async () => {
      mockStudioBackendPostEvent.mockImplementation(
        async ({ onEvent }: { onEvent: OnEvent }) => {
          // Send a non-done event, then return without sending "done"
          onEvent({ type: "is_alive_response" });
        },
      );

      const response = await makeRequest();
      expect(response).toBeDefined();
      expect(response!.status).toBe(200);

      // If streamDone never resolves, this read will hang and the test times out
      const fullResponse = await readStreamToCompletion(response!);
      expect(fullResponse).toContain("is_alive_response");
    }, 5000);
  });

  describe("when studioBackendPostEvent throws an error", () => {
    it("closes the SSE stream after sending the error event", async () => {
      mockStudioBackendPostEvent.mockRejectedValue(
        new Error("connection failed"),
      );

      const response = await makeRequest();
      expect(response).toBeDefined();
      expect(response!.status).toBe(200);

      const fullResponse = await readStreamToCompletion(response!);
      expect(fullResponse).toContain("connection failed");
    }, 5000);
  });

  describe("when studioBackendPostEvent sends a done event", () => {
    it("closes the SSE stream normally", async () => {
      mockStudioBackendPostEvent.mockImplementation(
        async ({ onEvent }: { onEvent: OnEvent }) => {
          onEvent({ type: "done" });
        },
      );

      const response = await makeRequest();
      expect(response).toBeDefined();
      expect(response!.status).toBe(200);

      const fullResponse = await readStreamToCompletion(response!);
      expect(fullResponse).toContain("done");
    }, 5000);
  });
});
