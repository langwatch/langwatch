import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModelProvidersApiError } from "@/client-sdk/services/model-providers/model-providers-api.service";

vi.mock("@/client-sdk/services/model-providers/model-providers-api.service", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ModelProvidersApiService: vi.fn(),
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

import { ModelProvidersApiService } from "@/client-sdk/services/model-providers/model-providers-api.service";
import { listModelProvidersCommand } from "../list";
import { setModelProviderCommand } from "../set";

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

describe("listModelProvidersCommand()", () => {
  let mockList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockList = vi.fn();
    vi.mocked(ModelProvidersApiService).mockImplementation(() => ({
      list: mockList,
      set: vi.fn(),
    }) as unknown as ModelProvidersApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when providers exist", () => {
    it("calls list and prints output", async () => {
      mockList.mockResolvedValue({
        openai: { provider: "openai", enabled: true, customKeys: {} },
      });

      await listModelProvidersCommand();

      expect(mockList).toHaveBeenCalledOnce();
    });
  });

  describe("when no providers exist", () => {
    it("prints empty-state message", async () => {
      mockList.mockResolvedValue({});

      await listModelProvidersCommand();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const providers = { openai: { provider: "openai", enabled: true, customKeys: {} } };
      mockList.mockResolvedValue(providers);

      await listModelProvidersCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(providers, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockList.mockRejectedValue(
        new ModelProvidersApiError("Network error", "list model providers"),
      );

      await expect(listModelProvidersCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("setModelProviderCommand()", () => {
  let mockSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSet = vi.fn();
    vi.mocked(ModelProvidersApiService).mockImplementation(() => ({
      list: vi.fn(),
      set: mockSet,
    }) as unknown as ModelProvidersApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when set succeeds", () => {
    it("calls set with provider name and enabled flag", async () => {
      mockSet.mockResolvedValue({});

      await setModelProviderCommand("openai", { enabled: true });

      expect(mockSet).toHaveBeenCalledWith("openai", expect.objectContaining({
        enabled: true,
      }));
    });
  });

  describe("when API key is provided", () => {
    it("maps the key to the correct field", async () => {
      mockSet.mockResolvedValue({});

      await setModelProviderCommand("openai", { enabled: true, apiKey: "sk-test" });

      expect(mockSet).toHaveBeenCalledWith("openai", expect.objectContaining({
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-test" },
      }));
    });
  });

  describe("when set fails", () => {
    it("exits with code 1", async () => {
      mockSet.mockRejectedValue(
        new ModelProvidersApiError("Failed", "set model provider"),
      );

      await expect(
        setModelProviderCommand("openai", { enabled: true }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});
