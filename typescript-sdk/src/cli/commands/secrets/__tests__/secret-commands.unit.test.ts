import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { listSecretsCommand } from "../list";
import { getSecretCommand } from "../get";
import { createSecretCommand } from "../create";
import { updateSecretCommand } from "../update";
import { deleteSecretCommand } from "../delete";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

const makeSecret = (overrides = {}) => ({
  id: "secret_abc",
  projectId: "proj_123",
  name: "MY_API_KEY",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("listSecretsCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("lists secrets in table format", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [makeSecret(), makeSecret({ id: "secret_def", name: "DB_PASSWORD" })],
    });

    await listSecretsCommand();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/secrets"),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("outputs JSON when format is json", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [makeSecret()],
    });

    await listSecretsCommand({ format: "json" });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("MY_API_KEY")
    );
  });

  it("exits on API error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "Internal" });
    await expect(listSecretsCommand()).rejects.toThrow(ProcessExitError);
  });
});

describe("getSecretCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("displays secret metadata", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeSecret(),
    });

    await getSecretCommand("secret_abc");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/secrets/secret_abc"),
      expect.any(Object)
    );
  });

  it("exits when secret not found", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });
    await expect(getSecretCommand("nonexistent")).rejects.toThrow(ProcessExitError);
  });
});

describe("createSecretCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("creates a secret", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeSecret(),
    });

    await createSecretCommand("MY_API_KEY", { value: "sk-123" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/secrets"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("MY_API_KEY"),
      })
    );
  });

  it("rejects invalid name format", async () => {
    await expect(
      createSecretCommand("invalid-name", { value: "test" })
    ).rejects.toThrow(ProcessExitError);
  });

  it("exits on conflict (409)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => "Already exists",
    });
    await expect(
      createSecretCommand("MY_KEY", { value: "val" })
    ).rejects.toThrow(ProcessExitError);
  });
});

describe("updateSecretCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("updates a secret value", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeSecret(),
    });

    await updateSecretCommand("secret_abc", { value: "new-value" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/secrets/secret_abc"),
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining("new-value"),
      })
    );
  });

  it("exits when secret not found", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });
    await expect(
      updateSecretCommand("bad_id", { value: "val" })
    ).rejects.toThrow(ProcessExitError);
  });
});

describe("deleteSecretCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  it("deletes a secret", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "secret_abc", deleted: true }),
    });

    await deleteSecretCommand("secret_abc");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/secrets/secret_abc"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("exits when secret not found", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });
    await expect(deleteSecretCommand("bad_id")).rejects.toThrow(ProcessExitError);
  });
});
