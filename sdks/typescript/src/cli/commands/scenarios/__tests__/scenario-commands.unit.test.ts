import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ScenarioResponse } from "@/client-sdk/services/scenarios";
import { ScenariosApiError, ScenariosApiService } from "@/client-sdk/services/scenarios";

vi.mock("@/client-sdk/services/scenarios", async (importOriginal) => {
  const actual = await importOriginal<typeof scenariosModule>();
  return {
    ...actual,
    ScenariosApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import type * as scenariosModule from "@/client-sdk/services/scenarios";

import { createScenarioCommand } from "../create";
import { deleteScenarioCommand } from "../delete";
import { getScenarioCommand } from "../get";
import { listScenariosCommand } from "../list";
import { updateScenarioCommand } from "../update";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () =>
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });

const makeScenario = (overrides: Partial<ScenarioResponse> = {}): ScenarioResponse => ({
  id: "scenario_abc123",
  name: "Login Flow",
  situation: "User attempts to log in with valid credentials",
  criteria: ["Responds with a welcome message", "Includes user name in greeting"],
  labels: ["auth", "happy-path"],
  parameters: [],
  simulatorModel: null,
  judgeModel: null,
  maxTurns: null,
  minTurns: null,
  testSuiteId: null,
  platformUrl: "https://app.langwatch.ai/proj-1/scenarios/scenario_abc123",
  ...overrides,
});

/** The platform's read by id: it answers for the fixture's id and nothing else. */
const getById = () =>
  vi.fn(async (id: string) => {
    const found = makeScenario();
    if (id !== found.id)
      throw new ScenariosApiError(`Scenario "${id}" not found`, `fetch scenario with ID "${id}"`);
    return found;
  });

describe("listScenariosCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(function () {
      return {
        getAll: mockGetAll,
        get: getById(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as unknown as ScenariosApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    exitSpy = mockProcessExit();
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

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetAll.mockRejectedValue(new ScenariosApiError("Network error", "fetch all scenarios"));

      await expect(listScenariosCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getScenarioCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    mockGet = getById();
    vi.mocked(ScenariosApiService).mockImplementation(function () {
      return {
        getAll: mockGetAll,
        get: mockGet,
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as unknown as ScenariosApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when the reference is an id", () => {
    /** @scenario "Get scenario details by ID" */
    it("returns the scenario that id names", async () => {
      mockGetAll.mockResolvedValue([
        makeScenario(),
        makeScenario({ id: "scenario_other", name: "Other" }),
      ]);

      const result = await getScenarioCommand("scenario_abc123");

      expect(result?.data).toMatchObject({ id: "scenario_abc123", name: "Login Flow" });
    });
  });

  describe("when the reference is a name", () => {
    /** @scenario "Get a scenario by its name" */
    it("returns the scenario that name names", async () => {
      mockGetAll.mockResolvedValue([
        makeScenario(),
        makeScenario({ id: "scenario_other", name: "Other" }),
      ]);

      const result = await getScenarioCommand("Login Flow");

      expect(result?.data).toMatchObject({ id: "scenario_abc123" });
    });

    /** @scenario "Get a scenario by its name ignoring case" */
    it("matches the name without case when no exact name matches", async () => {
      mockGetAll.mockResolvedValue([makeScenario()]);

      const result = await getScenarioCommand("login flow");

      expect(result?.data).toMatchObject({ id: "scenario_abc123" });
    });
  });

  describe("when two scenarios share the name", () => {
    /** @scenario "A name two scenarios share is refused with both ids" */
    it("exits with code 1 and lists both ids", async () => {
      mockGetAll.mockResolvedValue([
        makeScenario({ id: "scenario_one" }),
        makeScenario({ id: "scenario_two" }),
      ]);

      await expect(getScenarioCommand("Login Flow")).rejects.toThrow(ProcessExitError);
      const printed = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(printed).toContain("scenario_one");
      expect(printed).toContain("scenario_two");
    });
  });

  describe("when scenario is not found", () => {
    /** @scenario "Get scenario that does not exist" */
    it("exits with code 1", async () => {
      mockGetAll.mockResolvedValue([makeScenario()]);

      await expect(getScenarioCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(new ScenariosApiError("Network error", "fetch scenario"));
      mockGetAll.mockRejectedValue(new ScenariosApiError("Network error", "fetch all scenarios"));

      await expect(getScenarioCommand("scenario_abc123")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createScenarioCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(function () {
      return {
        getAll: vi.fn(),
        get: getById(),
        create: mockCreate,
        update: vi.fn(),
        delete: vi.fn(),
      } as unknown as ScenariosApiService;
    });
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
      mockCreate.mockRejectedValue(new ScenariosApiError("Limit reached", "create scenario"));

      await expect(createScenarioCommand("My Scenario", { situation: "test" })).rejects.toThrow(
        ProcessExitError,
      );
    });
  });
});

describe("updateScenarioCommand()", () => {
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(function () {
      return {
        getAll: vi.fn(async () => [makeScenario()]),
        get: getById(),
        create: vi.fn(),
        update: mockUpdate,
        delete: vi.fn(),
      } as unknown as ScenariosApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when update succeeds", () => {
    it("calls update with provided fields only", async () => {
      mockUpdate.mockResolvedValue(makeScenario({ name: "Updated Name" }));

      await updateScenarioCommand("scenario_abc123", { name: "Updated Name" });

      expect(mockUpdate).toHaveBeenCalledWith("scenario_abc123", {
        name: "Updated Name",
      });
    });
  });

  describe("when updating criteria", () => {
    it("parses comma-separated criteria", async () => {
      mockUpdate.mockResolvedValue(makeScenario());

      await updateScenarioCommand("scenario_abc123", {
        criteria: "Criterion 1,Criterion 2",
      });

      expect(mockUpdate).toHaveBeenCalledWith("scenario_abc123", {
        criteria: ["Criterion 1", "Criterion 2"],
      });
    });
  });

  describe("when the reference is a name", () => {
    /** @scenario "Update a scenario by its name" */
    it("updates the scenario that name names", async () => {
      mockUpdate.mockResolvedValue(makeScenario({ name: "Updated Name" }));

      await updateScenarioCommand("Login Flow", { name: "Updated Name" });

      expect(mockUpdate).toHaveBeenCalledWith("scenario_abc123", { name: "Updated Name" });
    });
  });

  describe("when the reference names no scenario", () => {
    /** @scenario "A reference that names no scenario is not found" */
    it("exits with code 1 without calling update", async () => {
      await expect(updateScenarioCommand("nonexistent", { name: "Updated" })).rejects.toThrow(
        ProcessExitError,
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when update fails", () => {
    it("exits with code 1", async () => {
      mockUpdate.mockRejectedValue(new ScenariosApiError("Server error", "update scenario"));

      await expect(updateScenarioCommand("scenario_abc123", { name: "Updated" })).rejects.toThrow(
        ProcessExitError,
      );
    });
  });
});

describe("deleteScenarioCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    mockDelete = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(function () {
      return {
        getAll: mockGetAll,
        get: getById(),
        create: vi.fn(),
        update: vi.fn(),
        delete: mockDelete,
      } as unknown as ScenariosApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when scenario exists and deletion succeeds", () => {
    /** @scenario "Delete (archive) a scenario" */
    it("resolves the scenario then deletes it", async () => {
      mockGetAll.mockResolvedValue([makeScenario()]);
      mockDelete.mockResolvedValue({ id: "scenario_abc123", archived: true });

      await deleteScenarioCommand("scenario_abc123");

      expect(mockDelete).toHaveBeenCalledWith("scenario_abc123");
    });
  });

  describe("when the reference is a name", () => {
    /** @scenario "Delete a scenario by its name" */
    it("deletes the scenario that name names", async () => {
      mockGetAll.mockResolvedValue([makeScenario()]);
      mockDelete.mockResolvedValue({ id: "scenario_abc123", archived: true });

      await deleteScenarioCommand("Login Flow");

      expect(mockDelete).toHaveBeenCalledWith("scenario_abc123");
    });
  });

  describe("when scenario is not found", () => {
    /** @scenario "Delete a scenario that does not exist" */
    it("exits with code 1 without calling delete", async () => {
      mockGetAll.mockResolvedValue([makeScenario()]);

      await expect(deleteScenarioCommand("nonexistent")).rejects.toThrow(ProcessExitError);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe("when delete API call fails", () => {
    it("exits with code 1", async () => {
      mockGetAll.mockResolvedValue([makeScenario()]);
      mockDelete.mockRejectedValue(new ScenariosApiError("Server error", "delete scenario"));

      await expect(deleteScenarioCommand("scenario_abc123")).rejects.toThrow(ProcessExitError);
    });
  });
});
