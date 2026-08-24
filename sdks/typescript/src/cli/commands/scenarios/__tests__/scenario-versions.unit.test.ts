/**
 * `langwatch scenario version list|get`: reading the saved versions of a test
 * case from the command line.
 *
 * The command line also WRITES history; that half is in
 * cli-scenarios-service.unit.test.ts.
 *
 * Spec: specs/features/scenario-cli.feature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/client-sdk/services/scenarios", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/scenarios")>();
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
    warn: vi.fn(),
    text: "",
  }),
}));

import {
  ScenariosApiError,
  ScenariosApiService,
} from "@/client-sdk/services/scenarios";
import { listScenarioVersionsCommand } from "../versions/list";
import { getScenarioVersionCommand } from "../versions/get";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const makeVersion = (overrides: Record<string, unknown> = {}) => ({
  version: 2,
  authorLabel: "cli",
  authorId: null,
  changeDescription: null,
  changedFields: ["name"],
  createdAt: "2026-02-01T10:00:00.000Z",
  synthesized: false,
  ...overrides,
});

describe("the scenario version commands", () => {
  let mockListVersions: ReturnType<typeof vi.fn>;
  let mockGetVersion: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListVersions = vi.fn();
    mockGetVersion = vi.fn();
    vi.mocked(ScenariosApiService).mockImplementation(function () {
      return {
        getAll: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        listVersions: mockListVersions,
        getVersion: mockGetVersion,
      } as unknown as ScenariosApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  describe("listScenarioVersionsCommand()", () => {
    /** @scenario "List the versions of a scenario" */
    it("shows the versions newest first with number, author, date and changed fields", async () => {
      mockListVersions.mockResolvedValue({
        versions: [
          makeVersion({ version: 3, changedFields: ["situation"] }),
          makeVersion({ version: 2, changedFields: ["name"] }),
          makeVersion({
            version: 1,
            authorLabel: null,
            changeDescription: "Created",
            changedFields: [],
            synthesized: true,
          }),
        ],
        nextCursor: null,
      });

      const result = await listScenarioVersionsCommand("scenario_abc123");
      result!.table();

      expect(mockListVersions).toHaveBeenCalledWith("scenario_abc123", {});
      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("v3");
      expect(printed).toContain("v2");
      expect(printed).toContain("cli");
      expect(printed).toContain("2026-02-01");
      expect(printed).toContain("situation");
      // Newest first: v3's row is printed above v2's.
      expect(printed.indexOf("v3")).toBeLessThan(printed.indexOf("v2"));
    });
  });

  describe("getScenarioVersionCommand()", () => {
    /** @scenario "Get one version of a scenario" */
    it("shows the name, situation, criteria and labels of that version", async () => {
      mockGetVersion.mockResolvedValue({
        ...makeVersion({ version: 2 }),
        schemaVersion: 1,
        snapshot: {
          name: "Login Flow v2",
          situation: "User logs in with a saved password",
          criteria: ["Greets the user", "Asks for the code"],
          labels: ["auth"],
          parameters: [],
          simulatorModel: null,
          judgeModel: null,
          maxTurns: null,
          minTurns: null,
        },
      });

      const result = await getScenarioVersionCommand("scenario_abc123", "2");
      result!.table();

      expect(mockGetVersion).toHaveBeenCalledWith("scenario_abc123", 2);
      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(printed).toContain("Login Flow v2");
      expect(printed).toContain("User logs in with a saved password");
      expect(printed).toContain("Greets the user");
      expect(printed).toContain("auth");
    });

    /** @scenario "Get a version that does not exist" */
    it("reports a version number that names nothing", async () => {
      mockGetVersion.mockRejectedValue(
        new ScenariosApiError(
          "scenario_version_not_found",
          "GET /api/scenarios/scenario_abc123/versions/9",
        ),
      );

      await expect(
        getScenarioVersionCommand("scenario_abc123", "9"),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});
