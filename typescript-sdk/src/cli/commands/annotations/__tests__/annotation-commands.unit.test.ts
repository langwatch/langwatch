import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnnotationsApiError } from "@/client-sdk/services/annotations/annotations-api.service";

vi.mock("@/client-sdk/services/annotations/annotations-api.service", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    AnnotationsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { AnnotationsApiService } from "@/client-sdk/services/annotations/annotations-api.service";
import { listAnnotationsCommand } from "../list";
import { getAnnotationCommand } from "../get";
import { createAnnotationCommand } from "../create";
import { deleteAnnotationCommand } from "../delete";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

const makeAnnotation = (overrides = {}) => ({
  id: "ann_123",
  traceId: "trace_abc",
  comment: "Great response",
  isThumbsUp: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("listAnnotationsCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    vi.mocked(AnnotationsApiService).mockImplementation(() => ({
      getAll: mockGetAll,
      get: vi.fn(),
      getByTrace: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    }) as unknown as AnnotationsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when annotations exist", () => {
    it("calls getAll and prints output", async () => {
      mockGetAll.mockResolvedValue([makeAnnotation()]);

      await listAnnotationsCommand({});

      expect(mockGetAll).toHaveBeenCalledOnce();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const annotations = [makeAnnotation()];
      mockGetAll.mockResolvedValue(annotations);

      await listAnnotationsCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(annotations, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetAll.mockRejectedValue(
        new AnnotationsApiError("Network error", "fetch all annotations"),
      );

      await expect(listAnnotationsCommand({})).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getAnnotationCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    vi.mocked(AnnotationsApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: mockGet,
      getByTrace: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    }) as unknown as AnnotationsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when annotation is found", () => {
    it("calls get with the provided ID", async () => {
      mockGet.mockResolvedValue(makeAnnotation());

      await getAnnotationCommand("ann_123");

      expect(mockGet).toHaveBeenCalledWith("ann_123");
    });
  });

  describe("when annotation is not found", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(
        new AnnotationsApiError("Not found", "fetch annotation"),
      );

      await expect(getAnnotationCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createAnnotationCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(AnnotationsApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      getByTrace: vi.fn(),
      create: mockCreate,
      delete: vi.fn(),
    }) as unknown as AnnotationsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when creation succeeds with thumbs up", () => {
    it("calls create with correct params", async () => {
      mockCreate.mockResolvedValue(makeAnnotation());

      await createAnnotationCommand("trace_abc", {
        comment: "Great response",
        thumbsUp: true,
      });

      expect(mockCreate).toHaveBeenCalledWith("trace_abc", {
        comment: "Great response",
        isThumbsUp: true,
        email: undefined,
      });
    });
  });

  describe("when creation succeeds with thumbs down", () => {
    it("sets isThumbsUp to false", async () => {
      mockCreate.mockResolvedValue(makeAnnotation({ isThumbsUp: false }));

      await createAnnotationCommand("trace_abc", {
        comment: "Bad response",
        thumbsDown: true,
      });

      expect(mockCreate).toHaveBeenCalledWith("trace_abc", {
        comment: "Bad response",
        isThumbsUp: false,
        email: undefined,
      });
    });
  });
});

describe("deleteAnnotationCommand()", () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete = vi.fn();
    vi.mocked(AnnotationsApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      getByTrace: vi.fn(),
      create: vi.fn(),
      delete: mockDelete,
    }) as unknown as AnnotationsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when deletion succeeds", () => {
    it("calls delete with the ID", async () => {
      mockDelete.mockResolvedValue({ status: "ok" });

      await deleteAnnotationCommand("ann_123");

      expect(mockDelete).toHaveBeenCalledWith("ann_123");
    });
  });

  describe("when deletion fails", () => {
    it("exits with code 1", async () => {
      mockDelete.mockRejectedValue(
        new AnnotationsApiError("Not found", "delete annotation"),
      );

      await expect(deleteAnnotationCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});
