/** Spec: modules/suite/specs/suite-templates.feature */
import type { SuiteTemplate } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { owaspLlmTop10Template } from "../../features/suite-templates/rules/owasp-llm-top-10-2025.rules.ts";
import {
  SuiteTemplateService,
  type SuiteTemplateServiceOptions,
} from "../suite-template.service.ts";

const by = { id: "user_1", label: "user" } as const;
const fit = {
  agentName: "ACME Support",
  tools: ["refund", "lookup_order"],
  mustNever: ["issue a refund above 100 EUR"],
};

const archetype: SuiteTemplate = {
  id: "tiny-archetype",
  version: 2,
  kind: "archetype",
  title: "Tiny",
  description: "A tiny archetype",
  criteria: ["Stays polite", "Never does: {{mustNever}}"],
  scenarios: [
    {
      key: "one",
      name: "{{agentName}} greets",
      situation: "A customer says hi",
      criteria: ["Greets back", "Stays polite"],
      labels: [],
    },
  ],
};

function setup(options: { capRefuses?: boolean; templates?: SuiteTemplate[] } = {}) {
  let next = 0;
  const create = vi.fn().mockImplementation(async () => ({ id: `scenario_${++next}` }));
  const createTestSuite = vi
    .fn()
    .mockResolvedValue({ id: "suite_1", slug: "owasp", name: "OWASP" });
  const assertScenarioCreationAllowed = vi.fn().mockImplementation(async () => {
    if (options.capRefuses)
      throw Object.assign(new Error("over the cap"), { code: "resource_limit_exceeded" });
  });
  const scenarios = createApiFixture<SuiteTemplateServiceOptions["scenarios"]>({
    create,
    createTestSuite,
    assertScenarioCreationAllowed,
  });
  const service = SuiteTemplateService.create({
    scenarios,
    ...(options.templates ? { templates: options.templates } : {}),
  });
  return { service, create, createTestSuite, assertScenarioCreationAllowed };
}

describe("SuiteTemplateService", () => {
  describe("when the caller lists templates", () => {
    /** @scenario "Listing templates answers every template sorted with full preview data" */
    it("answers every shipped template with its scenarios", () => {
      const templates = setup().service.listTemplates();
      expect(templates.map((template) => template.id)).toContain("owasp-llm-top-10-2025");
      const llmPack = templates.find((template) => template.id === "owasp-llm-top-10-2025");
      expect(llmPack?.scenarios[0]?.attack?.owaspIds).toEqual(["LLM01"]);
    });
  });

  describe("when the OWASP pack is applied", () => {
    /** @scenario "Applying a template creates a test suite with its scenarios" */
    it("creates the suite and ten red team scenarios filed in it", async () => {
      const { service, create } = setup();
      const applied = await service.applyTemplate(
        { projectId: "project_1", templateId: "owasp-llm-top-10-2025", fit },
        by,
      );
      expect(applied).toMatchObject({ suiteId: "suite_1", slug: "owasp", name: "OWASP" });
      expect(applied.scenarioIds).toHaveLength(10);
      expect(create).toHaveBeenCalledTimes(10);
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        projectId: "project_1",
        testSuiteId: "suite_1",
        kind: "red_team",
        redTeam: { owaspIds: ["LLM01"], strategy: "crescendo", maxTurns: 30 },
      });
    });

    /** @scenario "Applying fills the fit placeholders into every scenario's text" */
    it("leaves no placeholder in any created scenario", async () => {
      const { service, create } = setup();
      await service.applyTemplate(
        { projectId: "project_1", templateId: "owasp-llm-top-10-2025", fit },
        by,
      );
      const written = JSON.stringify(create.mock.calls.map((call) => call[0]));
      expect(written).not.toMatch(/\{\{(agentName|tools|mustNever)\}\}/);
      expect(written).toContain("ACME Support");
      expect(written).toContain("refund, lookup_order");
      expect(written).toContain("issue a refund above 100 EUR");
    });

    /** @scenario "The suite records the template id and version it came from" */
    it("records the template id and version on the suite", async () => {
      const { service, createTestSuite } = setup();
      await service.applyTemplate(
        { projectId: "project_1", templateId: "owasp-llm-top-10-2025", fit },
        by,
      );
      expect(createTestSuite).toHaveBeenCalledWith({
        projectId: "project_1",
        name: owaspLlmTop10Template.title,
        templateId: "owasp-llm-top-10-2025",
        templateVersion: 1,
      });
    });
  });

  describe("when a template declares template-wide criteria", () => {
    /** @scenario "Each scenario carries its own criteria followed by the template's" */
    it("appends them after the scenario's own, without duplicates", async () => {
      const { service, create } = setup({ templates: [archetype] });
      await service.applyTemplate(
        { projectId: "project_1", templateId: "tiny-archetype", fit },
        by,
      );
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        name: "ACME Support greets",
        kind: "standard",
        criteria: ["Greets back", "Stays polite", "Never does: issue a refund above 100 EUR"],
      });
    });
  });

  describe("when the plan cannot take every scenario", () => {
    /** @scenario "A plan creation cap that cannot take every scenario refuses before anything is written" */
    it("refuses with the scenarios limit before creating the suite", async () => {
      const { service, createTestSuite, create, assertScenarioCreationAllowed } = setup({
        capRefuses: true,
      });
      await expect(
        service.applyTemplate(
          { projectId: "project_1", templateId: "owasp-llm-top-10-2025", fit },
          by,
        ),
      ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
      expect(assertScenarioCreationAllowed).toHaveBeenCalledWith({
        projectId: "project_1",
        additional: 10,
        by,
      });
      expect(createTestSuite).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when the template id is unknown", () => {
    /** @scenario "Applying an unknown template is refused as not found" */
    it("refuses with suite_template_not_found and writes nothing", async () => {
      const { service, createTestSuite } = setup();
      await expect(
        service.applyTemplate({ projectId: "project_1", templateId: "no-such-template", fit }, by),
      ).rejects.toMatchObject({ code: "suite_template_not_found" });
      expect(createTestSuite).not.toHaveBeenCalled();
    });
  });

  describe("when the fit has no agent name", () => {
    /** @scenario "A fit without an agent name is refused as a validation error" */
    it("refuses before anything is written", async () => {
      const { service, createTestSuite } = setup();
      await expect(
        service.applyTemplate(
          {
            projectId: "project_1",
            templateId: "owasp-llm-top-10-2025",
            fit: { ...fit, agentName: " " },
          },
          by,
        ),
      ).rejects.toThrow(/agentName|too_small|at least/i);
      expect(createTestSuite).not.toHaveBeenCalled();
    });
  });
});
