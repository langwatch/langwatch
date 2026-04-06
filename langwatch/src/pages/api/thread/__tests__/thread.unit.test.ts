import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trace } from "~/server/tracer/types";

const mockGetTracesByThreadId = vi.fn();

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: () => ({
      getTracesByThreadId: mockGetTracesByThreadId,
    }),
  },
}));

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({}),
}));

const mockFindUnique = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: (...args: string[]) => mockFindUnique(...args),
    },
  },
}));

const mod = await import("../[id]");
// The handler accepts (req, res) — we call it with lightweight mocks
// that satisfy the properties the handler actually reads/writes.
const handler = mod.default as (
  req: {
    method: string;
    headers: Record<string, string>;
    query: Record<string, string>;
  },
  res: {
    status: (code: number) => { json: (data: Record<string, string>) => void; end: () => void };
    json: (data: Record<string, string>) => void;
    end: () => void;
  },
) => Promise<void>;

function createMockReq(overrides: {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
} = {}) {
  return {
    method: "GET",
    headers: { "x-auth-token": "valid-key" },
    query: { id: "thread-abc" },
    ...overrides,
  };
}

function createMockRes() {
  const json = vi.fn().mockReturnThis();
  const end = vi.fn();
  const status = vi.fn().mockReturnValue({ json, end });
  return { status, json, end };
}

const sampleProject = { id: "project-123", apiKey: "valid-key" };

const sampleTraces: Partial<Trace>[] = [
  {
    trace_id: "trace-1",
    project_id: "project-123",
    input: { value: "Hello" },
    output: { value: "Hi" },
    timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
    metadata: { thread_id: "thread-abc" },
    spans: [],
  },
  {
    trace_id: "trace-2",
    project_id: "project-123",
    input: { value: "How are you?" },
    output: { value: "Good" },
    timestamps: { started_at: 3000, inserted_at: 4000, updated_at: 4000 },
    metadata: { thread_id: "thread-abc" },
    spans: [],
  },
];

describe("GET /api/thread/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(sampleProject);
    mockGetTracesByThreadId.mockResolvedValue(sampleTraces);
  });

  describe("when called with valid auth and thread ID", () => {
    it("routes through TraceService instead of Elasticsearch", async () => {
      const req = createMockReq();
      const res = createMockRes();

      await handler(req, res);

      expect(mockGetTracesByThreadId).toHaveBeenCalledWith(
        "project-123",
        "thread-abc",
        expect.any(Object),
      );
    });

    it("returns traces in the response", async () => {
      const req = createMockReq();
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ traces: sampleTraces });
    });
  });

  describe("when auth token is missing", () => {
    it("returns 401", async () => {
      const req = createMockReq({ headers: {} });
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "X-Auth-Token header is required.",
      });
    });
  });

  describe("when auth token is invalid", () => {
    it("returns 401", async () => {
      mockFindUnique.mockResolvedValue(null);
      const req = createMockReq({
        headers: { "x-auth-token": "bad-key" },
      });
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Invalid auth token.",
      });
    });
  });

  describe("when method is not GET", () => {
    it("returns 405", async () => {
      const req = createMockReq({ method: "POST" });
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(405);
    });
  });

  describe("when thread has no traces", () => {
    it("returns empty array", async () => {
      mockGetTracesByThreadId.mockResolvedValue([]);
      const req = createMockReq();
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ traces: [] });
    });
  });
});
