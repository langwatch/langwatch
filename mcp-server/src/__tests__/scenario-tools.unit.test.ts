import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api.js", () => ({
  listScenarios: vi.fn(),
  getScenario: vi.fn(),
}));

import {
  listScenarios,
  getScenario,
} from "../langwatch-api.js";

import { handleListScenarios } from "../tools/list-scenarios.js";
import { handleGetScenario } from "../tools/get-scenario.js";
import { formatScenarioSchema } from "../tools/discover-scenario-schema.js";

const mockListScenarios = vi.mocked(listScenarios);
const mockGetScenario = vi.mocked(getScenario);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleListScenarios()", () => {
  const sampleScenarios = [
    {
      id: "scen_abc123",
      name: "Login Flow Happy Path",
      situation:
        "User attempts to log in with valid credentials and expects a welcome message back from the system",
      criteria: [
        "Responds with a welcome message",
        "Includes user name in greeting",
        "Sets session cookie",
      ],
      labels: ["auth", "happy-path"],
    },
    {
      id: "scen_def456",
      name: "Error Handling",
      situation: "User sends malformed input",
      criteria: ["Returns 400 status"],
      labels: ["error"],
    },
  ];

  describe("when scenarios exist (digest mode)", () => {
    let result: string;

    beforeEach(async () => {
      mockListScenarios.mockResolvedValue(sampleScenarios);
      result = await handleListScenarios({});
    });

    it("includes scenario id", () => {
      expect(result).toContain("scen_abc123");
    });

    it("includes scenario name", () => {
      expect(result).toContain("Login Flow Happy Path");
    });

    it("includes truncated situation preview", () => {
      expect(result).toContain("User attempts to log in");
      expect(result).not.toContain(
        "User attempts to log in with valid credentials and expects a welcome message back from the system"
      );
    });

    it("shows criteria count per scenario", () => {
      expect(result).toContain("3 criteria");
    });

    it("includes labels", () => {
      expect(result).toContain("auth");
    });

    it("includes all scenarios in the list", () => {
      expect(result).toContain("scen_def456");
    });
  });

  describe("when no scenarios exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListScenarios.mockResolvedValue([]);
      result = await handleListScenarios({});
    });

    it("returns a no-scenarios message", () => {
      expect(result).toContain("No scenarios found");
    });

    it("includes a tip to use create_scenario", () => {
      expect(result).toContain("create_scenario");
    });
  });

  describe("when format is json", () => {
    it("returns valid parseable JSON matching the scenario structure", async () => {
      mockListScenarios.mockResolvedValue(sampleScenarios);
      const result = await handleListScenarios({ format: "json" });
      expect(JSON.parse(result)).toEqual(sampleScenarios);
    });
  });
});

describe("handleGetScenario()", () => {
  const sampleScenario = {
    id: "scen_abc123",
    name: "Login Flow Happy Path",
    situation: "User attempts to log in with valid credentials",
    criteria: [
      "Responds with a welcome message",
      "Includes user name in greeting",
    ],
    labels: ["auth", "happy-path"],
  };

  describe("when format is json", () => {
    it("returns valid parseable JSON matching the scenario structure", async () => {
      mockGetScenario.mockResolvedValue(sampleScenario);
      const result = await handleGetScenario({
        scenarioId: "scen_abc123",
        format: "json",
      });
      expect(JSON.parse(result)).toEqual(sampleScenario);
    });
  });
});

describe("formatScenarioSchema()", () => {
  it("includes all required field descriptions", () => {
    const result = formatScenarioSchema();
    expect(result).toContain("name");
    expect(result).toContain("situation");
    expect(result).toContain("criteria");
    expect(result).toContain("labels");
  });

  it("includes all target types", () => {
    const result = formatScenarioSchema();
    expect(result).toContain("prompt");
    expect(result).toContain("http");
    expect(result).toContain("code");
  });

  it("includes examples of good criteria", () => {
    const result = formatScenarioSchema();
    expect(result.toLowerCase()).toMatch(/example/);
  });
});
