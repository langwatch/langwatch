// Test the suite template commands: listing templates and applying one with a fit.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { TestSuitesApiError } from "@/client-sdk/services/test-suites";

import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const listTemplatesSpy = vi.hoisted(() => vi.fn());
const applyTemplateSpy = vi.hoisted(() => vi.fn());

vi.mock("../cli-test-suites-service", () => ({
  createCliTestSuitesService: vi.fn(() => ({
    listTemplates: listTemplatesSpy,
    applyTemplate: applyTemplateSpy,
  })),
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

import { applySuiteTemplateCommand, listSuiteTemplatesCommand } from "../templates";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

const template = {
  id: "owasp-llm-top-10-2025",
  version: 1,
  kind: "red_team_pack",
  title: "OWASP LLM Top 10 (2025)",
  description: "Red team pack",
  criteria: [],
  scenarios: [{ key: "llm07", name: "System prompt leak" }],
};

let savedAgentEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  savedAgentEnv = Object.fromEntries(AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]));
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
  listTemplatesSpy.mockResolvedValue([template]);
  applyTemplateSpy.mockResolvedValue({
    suiteId: "suite_abc",
    slug: "owasp-llm-top-10-2025",
    name: "OWASP LLM Top 10 (2025)",
    scenarioIds: ["scenario_1"],
  });
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

afterEach(() => {
  for (const name of AGENT_MODE_ENV_VARS) {
    const value = savedAgentEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("listSuiteTemplatesCommand()", () => {
  it("returns the templates as the payload", async () => {
    const result = await listSuiteTemplatesCommand();

    expect(result?.data).toEqual([template]);
  });

  describe("when the API refuses", () => {
    it("exits with code 1", async () => {
      listTemplatesSpy.mockRejectedValue(new TestSuitesApiError("nope", "list suite templates"));

      await expect(listSuiteTemplatesCommand()).rejects.toMatchObject({ code: 1 });
    });
  });
});

describe("applySuiteTemplateCommand()", () => {
  it("sends the fit with every repeated tool and must-never rule", async () => {
    await applySuiteTemplateCommand({
      templateId: "owasp-llm-top-10-2025",
      agentName: "Support bot",
      tools: ["refund_order", "lookup_order"],
      mustNever: ["reveal the system prompt"],
    });

    expect(applyTemplateSpy).toHaveBeenCalledWith({
      templateId: "owasp-llm-top-10-2025",
      body: {
        fit: {
          agentName: "Support bot",
          tools: ["refund_order", "lookup_order"],
          mustNever: ["reveal the system prompt"],
        },
      },
    });
  });

  it("sends empty lists and the suite name when given", async () => {
    await applySuiteTemplateCommand({
      templateId: "support-agent",
      agentName: "Support bot",
      name: "Support basics",
    });

    expect(applyTemplateSpy).toHaveBeenCalledWith({
      templateId: "support-agent",
      body: {
        fit: { agentName: "Support bot", tools: [], mustNever: [] },
        name: "Support basics",
      },
    });
  });

  it("returns the created suite as the payload", async () => {
    const result = await applySuiteTemplateCommand({
      templateId: "owasp-llm-top-10-2025",
      agentName: "Support bot",
    });

    expect(result?.data).toMatchObject({ suiteId: "suite_abc", scenarioIds: ["scenario_1"] });
  });

  describe("when the template is unknown", () => {
    it("exits with code 1", async () => {
      applyTemplateSpy.mockRejectedValue(
        new TestSuitesApiError("suite_template_not_found", "apply suite template", undefined, 404),
      );

      await expect(
        applySuiteTemplateCommand({ templateId: "nope", agentName: "Support bot" }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });
});
