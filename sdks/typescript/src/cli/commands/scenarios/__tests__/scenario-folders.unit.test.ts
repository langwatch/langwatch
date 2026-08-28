/**
 * Filing a scenario into a test suite from the command line.
 *
 * The suite is named by id or by name, and it is resolved through the test
 * suites API before the case is written, so a name that matches nothing leaves
 * no half-filed case behind.
 *
 * Spec: specs/features/scenario-cli.feature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScenarioResponse } from "@/client-sdk/services/scenarios";

const mockSuitesList = vi.hoisted(() => vi.fn());

vi.mock("@/client-sdk/services/scenarios", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/scenarios")>();
  return {
    ...actual,
    ScenariosApiService: vi.fn(),
  };
});

vi.mock("../../test-suites/cli-test-suites-service", () => ({
  createCliTestSuitesService: vi.fn(() => ({ list: mockSuitesList })),
}));

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
    warn: vi.fn(),
    text: "",
  }),
}));

import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { createScenarioCommand } from "../create";
import { updateScenarioCommand } from "../update";
import { listScenariosCommand } from "../list";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const makeScenario = (
  overrides: Partial<ScenarioResponse> = {},
): ScenarioResponse => ({
  id: "scenario_abc123",
  name: "Login Flow",
  situation: "User attempts to log in",
  criteria: [],
  labels: [],
  parameters: [],
  folderId: null,
  platformUrl: "https://app.langwatch.ai/proj-1/scenarios/scenario_abc123",
  ...overrides,
});

const makeFolder = (overrides: Record<string, unknown> = {}) => ({
  id: "folder_abc",
  name: "Refunds",
  slug: "refunds",
  scenarioIds: [],
  scenarioCount: 0,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/proj-1/agent-testing",
  ...overrides,
});

describe("filing a scenario into a folder from the command line", () => {
  let mockScenarioCreate: ReturnType<typeof vi.fn>;
  let mockScenarioUpdate: ReturnType<typeof vi.fn>;
  let mockScenarioGetAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockScenarioCreate = vi.fn().mockResolvedValue(makeScenario());
    mockScenarioUpdate = vi.fn().mockResolvedValue(makeScenario());
    mockScenarioGetAll = vi.fn().mockResolvedValue([]);
    mockSuitesList.mockResolvedValue([]);

    vi.mocked(ScenariosApiService).mockImplementation(function () {
      return {
        getAll: mockScenarioGetAll,
        get: vi.fn(),
        create: mockScenarioCreate,
        update: mockScenarioUpdate,
        delete: vi.fn(),
        listVersions: vi.fn(),
        getVersion: vi.fn(),
      } as unknown as ScenariosApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  describe("createScenarioCommand() with --folder", () => {
    /** @scenario "Create a scenario inside a test suite" */
    it("creates the scenario inside that folder", async () => {
      mockSuitesList.mockResolvedValue([makeFolder()]);
      mockScenarioCreate.mockResolvedValue(
        makeScenario({ folderId: "folder_abc" }),
      );

      const result = await createScenarioCommand("Login Flow", {
        situation: "User logs in",
        folder: "folder_abc",
      });

      expect(mockSuitesList).toHaveBeenCalled();
      expect(mockScenarioCreate).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: "folder_abc" }),
      );
      expect(result!.data).toMatchObject({ folderId: "folder_abc" });
    });

    /** @scenario "Create a scenario inside a test suite" */
    it("names the folder in the confirmation", async () => {
      mockSuitesList.mockResolvedValue([makeFolder()]);
      mockScenarioCreate.mockResolvedValue(
        makeScenario({ folderId: "folder_abc" }),
      );

      await createScenarioCommand("Login Flow", {
        situation: "User logs in",
        folder: "Refunds",
      });

      // Named by name rather than by id, and still resolved to the folder.
      expect(mockScenarioCreate).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: "folder_abc" }),
      );
    });

    /** @scenario "Create a scenario with a test suite that does not exist" */
    it("refuses a folder that names nothing, and creates no scenario", async () => {
      mockSuitesList.mockResolvedValue([]);

      await expect(
        createScenarioCommand("Login Flow", {
          situation: "User logs in",
          folder: "nonexistent-id",
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockScenarioCreate).not.toHaveBeenCalled();
      const reported = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(reported).toContain("not found");
    });
  });

  describe("updateScenarioCommand() with --folder", () => {
    /** @scenario "Move a scenario to another test suite" */
    it("moves the scenario into the named folder", async () => {
      mockSuitesList.mockResolvedValue([
        makeFolder({ id: "folder_xyz", name: "Chargebacks" }),
      ]);
      mockScenarioUpdate.mockResolvedValue(
        makeScenario({ folderId: "folder_xyz" }),
      );

      const result = await updateScenarioCommand("scenario_abc123", {
        folder: "folder_xyz",
      });

      expect(mockScenarioUpdate).toHaveBeenCalledWith("scenario_abc123", {
        folderId: "folder_xyz",
      });
      // A case belongs to one folder, so the new one replaces the old.
      expect(result!.data).toMatchObject({ folderId: "folder_xyz" });
    });

    /** @scenario "Unfile a scenario from its test suite" */
    it("takes the scenario out of its folder with --no-folder", async () => {
      mockScenarioUpdate.mockResolvedValue(makeScenario({ folderId: null }));

      const result = await updateScenarioCommand("scenario_abc123", {
        noFolder: true,
      });

      expect(mockScenarioUpdate).toHaveBeenCalledWith("scenario_abc123", {
        folderId: null,
      });
      expect(result!.data).toMatchObject({ folderId: null });
      expect(mockSuitesList).not.toHaveBeenCalled();
    });

    /** @scenario "Combining --folder and --no-folder is rejected" */
    it("refuses both options together, leaving the scenario unchanged", async () => {
      await expect(
        updateScenarioCommand("scenario_abc123", {
          folder: "folder_abc",
          noFolder: true,
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockScenarioUpdate).not.toHaveBeenCalled();
      const reported = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(reported).toContain("cannot be used together");
    });
  });

  describe("listScenariosCommand()", () => {
    /** @scenario "List scenarios shows the folder each one belongs to" */
    it("has a folder column naming the folder of each filed case", async () => {
      mockScenarioGetAll.mockResolvedValue([
        makeScenario({ id: "scenario_1", folderId: "folder_abc" }),
        makeScenario({ id: "scenario_2", folderId: null }),
      ]);
      mockSuitesList.mockResolvedValue([makeFolder()]);

      const result = await listScenariosCommand();
      result!.table();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Folder");
      expect(printed).toContain("Refunds");
    });

    /** @scenario "List scenarios shows the folder each one belongs to" */
    it("reads a case with no folder as unfiled", async () => {
      mockScenarioGetAll.mockResolvedValue([
        makeScenario({ id: "scenario_2", folderId: null }),
      ]);

      const result = await listScenariosCommand();
      result!.table();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("unfiled");
    });
  });
});
