import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScenarioResponse } from "@/client-sdk/services/scenarios";
import { ScenariosApiError } from "@/client-sdk/services/scenarios";

vi.mock("@/client-sdk/services/scenarios", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/scenarios")>();
  return {
    ...actual,
    ScenariosApiService: vi.fn(),
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

import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { listScenariosCommand } from "../list";
import { getScenarioCommand } from "../get";
import { createScenarioCommand } from "../create";
import { updateScenarioCommand } from "../update";
import { deleteScenarioCommand } from "../delete";

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

const makeScenario = (overrides: Partial<ScenarioResponse> = {}): ScenarioResponse => ({
  id: "scenario_abc123",
  name: "Login Flow",
  situation: "User attempts to log in with valid credentials",
  criteria: ["Responds with a welcome message", "Includes user name in greeting"],
  labels: ["auth", "happy-path"],
  platformUrl: "https://app.langwatch.ai/proj-1/scenarios/scenario_abc123",
  ...overrides,
});

describe("listScenariosCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(() => ({
      getAll: mockGetAll,
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }) as unknown as ScenariosApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when scenarios exist", () => {
    it("calls getAll and prints output", async () => {
      mockGetAll.mockResolvedValue([makeScenario()]);

      await listScenariosCommand();

      expect(mockGetAll).toHaveBeenCalledOnce();
    });
  });

  describe("when no scenarios exist", () => {
    it("prints empty-state guidance", async () => {
      mockGetAll.mockResolvedValue([]);

      await listScenariosCommand();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetAll.mockRejectedValue(
        new ScenariosApiError("Network error", "fetch all scenarios"),
      );

      await expect(listScenariosCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getScenarioCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: mockGet,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }) as unknown as ScenariosApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when scenario is found", () => {
    it("calls get with the provided ID", async () => {
      mockGet.mockResolvedValue(makeScenario());

      await getScenarioCommand("scenario_abc123");

      expect(mockGet).toHaveBeenCalledWith("scenario_abc123");
    });
  });

  describe("when scenario is not found", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(
        new ScenariosApiError("Not found", "fetch scenario"),
      );

      await expect(getScenarioCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createScenarioCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: mockCreate,
      update: vi.fn(),
      delete: vi.fn(),
    }) as unknown as ScenariosApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when creation succeeds", () => {
    it("calls create with name, situation, criteria, and labels", async () => {
      mockCreate.mockResolvedValue(makeScenario({ name: "Login Flow" }));

      await createScenarioCommand("Login Flow", {
        situation: "User attempts to log in",
        criteria: "Greets user,Asks for password",
        labels: "auth,happy-path",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        name: "Login Flow",
        situation: "User attempts to log in",
        criteria: ["Greets user", "Asks for password"],
        labels: ["auth", "happy-path"],
      });
    });
  });

  describe("when creation succeeds without optional fields", () => {
    it("passes empty arrays for criteria and labels", async () => {
      mockCreate.mockResolvedValue(makeScenario({ name: "Simple Scenario" }));

      await createScenarioCommand("Simple Scenario", {
        situation: "Basic situation",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        name: "Simple Scenario",
        situation: "Basic situation",
        criteria: [],
        labels: [],
      });
    });
  });

  describe("when creation fails", () => {
    it("exits with code 1", async () => {
      mockCreate.mockRejectedValue(
        new ScenariosApiError("Limit reached", "create scenario"),
      );

      await expect(
        createScenarioCommand("My Scenario", { situation: "test" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("updateScenarioCommand()", () => {
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: mockUpdate,
      delete: vi.fn(),
    }) as unknown as ScenariosApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when update succeeds", () => {
    it("calls update with provided fields only", async () => {
      mockUpdate.mockResolvedValue(makeScenario({ name: "Updated Name" }));

      await updateScenarioCommand("scenario_abc123", { name: "Updated Name" });

      expect(mockUpdate).toHaveBeenCalledWith("scenario_abc123", { name: "Updated Name" });
    });
  });

  describe("when updating criteria", () => {
    it("parses comma-separated criteria", async () => {
      mockUpdate.mockResolvedValue(makeScenario());

      await updateScenarioCommand("scenario_abc123", { criteria: "Criterion 1,Criterion 2" });

      expect(mockUpdate).toHaveBeenCalledWith("scenario_abc123", {
        criteria: ["Criterion 1", "Criterion 2"],
      });
    });
  });

  describe("when update fails", () => {
    it("exits with code 1", async () => {
      mockUpdate.mockRejectedValue(
        new ScenariosApiError("Not found", "update scenario"),
      );

      await expect(
        updateScenarioCommand("nonexistent", { name: "Updated" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("deleteScenarioCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    mockDelete = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(() => ({
      getAll: vi.fn(),
      get: mockGet,
      create: vi.fn(),
      update: vi.fn(),
      delete: mockDelete,
    }) as unknown as ScenariosApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when scenario exists and deletion succeeds", () => {
    it("resolves the scenario then deletes it", async () => {
      mockGet.mockResolvedValue(makeScenario());
      mockDelete.mockResolvedValue({ id: "scenario_abc123", archived: true });

      await deleteScenarioCommand("scenario_abc123");

      expect(mockGet).toHaveBeenCalledWith("scenario_abc123");
      expect(mockDelete).toHaveBeenCalledWith("scenario_abc123");
    });
  });

  describe("when scenario is not found", () => {
    it("exits with code 1 without calling delete", async () => {
      mockGet.mockRejectedValue(
        new ScenariosApiError("Not found", "fetch scenario"),
      );

      await expect(deleteScenarioCommand("nonexistent")).rejects.toThrow(ProcessExitError);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe("when delete API call fails", () => {
    it("exits with code 1", async () => {
      mockGet.mockResolvedValue(makeScenario());
      mockDelete.mockRejectedValue(
        new ScenariosApiError("Server error", "delete scenario"),
      );

      await expect(deleteScenarioCommand("scenario_abc123")).rejects.toThrow(ProcessExitError);
    });
  });
});
