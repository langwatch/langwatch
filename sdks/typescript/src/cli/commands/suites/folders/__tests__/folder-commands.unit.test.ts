/**
 * The `langwatch suite folder` group: a folder is a suite of kind "folder", so
 * every command here goes through the suites API and never through a surface
 * of its own.
 *
 * Spec: specs/features/suite-cli.feature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/client-sdk/services/suites", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/suites")>();
  return {
    ...actual,
    SuitesApiService: vi.fn(),
  };
});

vi.mock("../../../../utils/apiKey", () => ({
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

import { SuitesApiService } from "@/client-sdk/services/suites";
import { listFoldersCommand } from "../list";
import { createFolderCommand } from "../create";
import { renameFolderCommand } from "../rename";
import { deleteFolderCommand } from "../delete";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const makeFolder = (overrides: Record<string, unknown> = {}) => ({
  id: "folder_abc",
  name: "Refunds",
  slug: "refunds",
  kind: "folder" as const,
  description: null,
  scenarioIds: ["scenario_1", "scenario_2"],
  targets: [],
  repeatCount: 1,
  labels: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  ...overrides,
});

describe("the suite folder commands", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn().mockResolvedValue([]);
    mockCreate = vi.fn();
    mockUpdate = vi.fn();
    mockDelete = vi.fn().mockResolvedValue({ id: "folder_abc", archived: true });
    vi.mocked(SuitesApiService).mockImplementation(function () {
      return {
        getAll: mockGetAll,
        get: vi.fn(),
        create: mockCreate,
        update: mockUpdate,
        duplicate: vi.fn(),
        run: vi.fn(),
        delete: mockDelete,
      } as unknown as SuitesApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  describe("listFoldersCommand()", () => {
    /** @scenario "List test suite folders" */
    it("asks for folders only, so run plans are not listed", async () => {
      mockGetAll.mockResolvedValue([makeFolder()]);

      await listFoldersCommand();

      expect(mockGetAll).toHaveBeenCalledWith({ kind: "folder" });
    });

    /** @scenario "List test suite folders" */
    it("shows the name, ID and scenario count of each folder", async () => {
      mockGetAll.mockResolvedValue([makeFolder()]);

      const result = await listFoldersCommand();
      result!.table();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Refunds");
      expect(printed).toContain("folder_abc");
      expect(printed).toContain("Scenarios");
      expect(printed).toContain("2");
    });

    /** @scenario "List test suite folders when none exist" */
    it("says no folders were found when the project has none", async () => {
      mockGetAll.mockResolvedValue([]);

      const result = await listFoldersCommand();
      result!.table();

      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("No test suite folders found");
    });
  });

  describe("createFolderCommand()", () => {
    /** @scenario "Create a test suite folder" */
    it("creates a suite of kind folder and reports its name and ID", async () => {
      mockCreate.mockResolvedValue(makeFolder({ scenarioIds: [] }));

      const result = await createFolderCommand("Refunds");

      expect(mockCreate).toHaveBeenCalledWith({
        name: "Refunds",
        kind: "folder",
      });
      expect(result!.data).toMatchObject({ id: "folder_abc", name: "Refunds" });
    });

    /** @scenario "Create a test suite folder" */
    it("creates it holding no scenarios", async () => {
      mockCreate.mockResolvedValue(makeFolder({ scenarioIds: [] }));

      const result = await createFolderCommand("Refunds");

      expect(
        (result!.data as { scenarioIds: string[] }).scenarioIds,
      ).toEqual([]);
    });

    // The platform gives the folder a distinct slug rather than refusing, so
    // the command has nothing to do beyond reporting what came back.
    /** @scenario "Create a test suite folder with a name another suite already uses" */
    it("reports the distinct slug the platform gave it", async () => {
      mockCreate.mockResolvedValue(
        makeFolder({ slug: "refunds-2", scenarioIds: [] }),
      );

      const result = await createFolderCommand("Refunds");

      expect(result!.data).toMatchObject({
        id: "folder_abc",
        name: "Refunds",
        slug: "refunds-2",
      });
    });
  });

  describe("renameFolderCommand()", () => {
    /** @scenario "Rename a test suite folder" */
    it("renames the folder and reports the new name", async () => {
      mockGetAll.mockResolvedValue([makeFolder()]);
      mockUpdate.mockResolvedValue(makeFolder({ name: "Refunds and credits" }));

      const result = await renameFolderCommand(
        "folder_abc",
        "Refunds and credits",
      );

      expect(mockUpdate).toHaveBeenCalledWith("folder_abc", {
        name: "Refunds and credits",
      });
      expect(result!.data).toMatchObject({ name: "Refunds and credits" });
    });
  });

  describe("deleteFolderCommand()", () => {
    /** @scenario "Delete (archive) a test suite folder" */
    it("archives the folder", async () => {
      mockGetAll.mockResolvedValue([makeFolder()]);

      const result = await deleteFolderCommand("folder_abc");

      expect(mockDelete).toHaveBeenCalledWith("folder_abc");
      expect(result!.data).toMatchObject({ archived: true });
    });

    /** @scenario "Delete (archive) a test suite folder" */
    it("says its scenarios were archived too", async () => {
      mockGetAll.mockResolvedValue([makeFolder()]);

      const result = await deleteFolderCommand("folder_abc");

      expect(result!.data).toMatchObject({ archivedScenarioCount: 2 });
    });

    /** @scenario "Delete a test suite folder that does not exist" */
    it("refuses an id that names no folder, without archiving anything", async () => {
      mockGetAll.mockResolvedValue([]);

      await expect(deleteFolderCommand("nonexistent-id")).rejects.toThrow(
        ProcessExitError,
      );

      expect(mockDelete).not.toHaveBeenCalled();
      const reported = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(reported).toContain("not found");
    });
  });
});
