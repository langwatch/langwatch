import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as ExperimentsApiModule from "@/client-sdk/services/experiments/experiments-api.service";

vi.mock(
  "@/client-sdk/services/experiments/experiments-api.service",
  async (importOriginal) => {
    const actual = await importOriginal<typeof ExperimentsApiModule>();
    return {
      ...actual,
      ExperimentsApiService: vi.fn(),
    };
  },
);

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

import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { experimentCreateCommand } from "../create";
import { experimentGetStateCommand } from "../get-state";
import { experimentSetStateCommand } from "../set-state";
import { experimentVersionsCommand } from "../versions";
import { experimentRestoreCommand } from "../restore";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // suppress output during tests
};

const state = { name: "Checkout", datasets: [], targets: [] };

describe("the experiment workbench commands", () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockGetWorkbenchState: ReturnType<typeof vi.fn>;
  let mockSetWorkbenchState: ReturnType<typeof vi.fn>;
  let mockListVersions: ReturnType<typeof vi.fn>;
  let mockRestoreVersion: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    mockGetWorkbenchState = vi.fn();
    mockSetWorkbenchState = vi.fn();
    mockListVersions = vi.fn();
    mockRestoreVersion = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(function () {
      return {
        create: mockCreate,
        getWorkbenchState: mockGetWorkbenchState,
        setWorkbenchState: mockSetWorkbenchState,
        listVersions: mockListVersions,
        restoreVersion: mockRestoreVersion,
      } as unknown as ExperimentsApiService;
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a create call", () => {
    describe("when a name is given", () => {
      /** @scenario "Creating an experiment from the CLI" */
      it("passes the name and returns the new slug", async () => {
        mockCreate.mockResolvedValue({
          id: "exp_1",
          slug: "checkout",
          version: 1,
        });

        const result = await experimentCreateCommand({ name: "Checkout" });

        expect(mockCreate).toHaveBeenCalledWith({ name: "Checkout" });
        expect(result?.data).toMatchObject({ slug: "checkout", version: 1 });
      });
    });

    describe("when no name is given", () => {
      it("sends no name so the platform picks one", async () => {
        mockCreate.mockResolvedValue({
          id: "exp_1",
          slug: "draft",
          version: 1,
        });

        await experimentCreateCommand();

        expect(mockCreate).toHaveBeenCalledWith({});
      });
    });
  });

  describe("given a get-state call", () => {
    describe("when fields is version", () => {
      /** @scenario "Checking an experiment's version without pulling its setup" */
      it("asks for the version only", async () => {
        mockGetWorkbenchState.mockResolvedValue({
          id: "exp_1",
          slug: "checkout",
          version: 4,
          updatedAt: "2026-01-02T00:00:00Z",
        });

        const result = await experimentGetStateCommand("checkout", {
          fields: "version",
        });

        expect(mockGetWorkbenchState).toHaveBeenCalledWith({
          slug: "checkout",
          fields: "version",
        });
        expect(result?.data).toMatchObject({ version: 4 });
      });
    });

    describe("when no fields are asked for", () => {
      it("returns the full setup", async () => {
        mockGetWorkbenchState.mockResolvedValue({
          id: "exp_1",
          slug: "checkout",
          name: "Checkout",
          state,
          version: 4,
          updatedAt: "2026-01-02T00:00:00Z",
        });

        const result = await experimentGetStateCommand("checkout");

        expect(mockGetWorkbenchState).toHaveBeenCalledWith({
          slug: "checkout",
        });
        expect(result?.data).toMatchObject({ state });
      });
    });
  });

  describe("given a set-state call", () => {
    describe("when the setup comes from a file", () => {
      /** @scenario "Saving a setup from a file" */
      it("sends the parsed setup with the expected version and message", async () => {
        const directory = await mkdtemp(join(tmpdir(), "langwatch-cli-"));
        const file = join(directory, "state.json");
        await writeFile(file, JSON.stringify(state), "utf8");
        mockSetWorkbenchState.mockResolvedValue({ version: 5 });

        const result = await experimentSetStateCommand("checkout", {
          file,
          expectedVersion: "4",
          message: "Added a target",
        });

        expect(mockSetWorkbenchState).toHaveBeenCalledWith({
          slug: "checkout",
          state,
          expectedVersion: 4,
          commitMessage: "Added a target",
        });
        expect(result?.data).toMatchObject({ version: 5 });
      });
    });

    describe("when no file is given", () => {
      it("refuses and exits", async () => {
        await expect(
          experimentSetStateCommand("checkout", {}),
        ).rejects.toThrow(ProcessExitError);
        expect(mockSetWorkbenchState).not.toHaveBeenCalled();
      });
    });

    describe("when the file is not valid JSON", () => {
      it("refuses and exits", async () => {
        const directory = await mkdtemp(join(tmpdir(), "langwatch-cli-"));
        const file = join(directory, "state.json");
        await writeFile(file, "not json at all", "utf8");

        await expect(
          experimentSetStateCommand("checkout", { file }),
        ).rejects.toThrow(ProcessExitError);
        expect(mockSetWorkbenchState).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a versions call", () => {
    describe("when the experiment has versions", () => {
      /** @scenario "Listing an experiment's versions" */
      it("renders a row per version naming who wrote it", async () => {
        mockListVersions.mockResolvedValue({
          versions: [
            {
              version: 2,
              autoSaved: false,
              commitMessage: "Added a target",
              authorLabel: "langy",
              authorId: null,
              createdAt: new Date().toISOString(),
            },
            {
              version: 1,
              autoSaved: true,
              commitMessage: null,
              authorLabel: "user",
              authorId: "user_1",
              createdAt: new Date().toISOString(),
            },
          ],
          nextCursor: null,
        });

        const result = await experimentVersionsCommand("checkout");
        result?.table();
        const printed = logSpy.mock.calls.flat().join("\n");

        expect(mockListVersions).toHaveBeenCalledWith({
          slug: "checkout",
          limit: 50,
        });
        expect(printed).toContain("v2");
        expect(printed).toContain("Langy");
        expect(printed).toContain("Added a target");
      });
    });

    describe("when the experiment has no versions", () => {
      it("prints an empty-state message", async () => {
        mockListVersions.mockResolvedValue({ versions: [], nextCursor: null });

        const result = await experimentVersionsCommand("checkout");
        result?.table();
        const printed = logSpy.mock.calls.flat().join("\n");

        expect(printed.toLowerCase()).toContain("no saved versions");
      });
    });
  });

  describe("given a restore call", () => {
    describe("when the version is a number", () => {
      /** @scenario "Restoring an experiment version from the CLI" */
      it("restores it and reports the version the restore wrote", async () => {
        mockRestoreVersion.mockResolvedValue({ version: 7 });

        const result = await experimentRestoreCommand("checkout", "3");

        expect(mockRestoreVersion).toHaveBeenCalledWith({
          slug: "checkout",
          version: 3,
        });
        expect(result?.data).toMatchObject({
          restoredFrom: 3,
          version: 7,
        });
      });
    });

    describe("when the version is not a number", () => {
      it("refuses and exits", async () => {
        await expect(
          experimentRestoreCommand("checkout", "latest"),
        ).rejects.toThrow(ProcessExitError);
        expect(mockRestoreVersion).not.toHaveBeenCalled();
      });
    });
  });
});
