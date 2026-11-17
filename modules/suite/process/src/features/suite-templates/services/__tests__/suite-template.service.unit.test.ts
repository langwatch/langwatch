/** Spec: modules/suite/specs/suite-templates.feature */
import type { SuiteTemplate } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { owaspLlmTop10Template } from "../../rules/owasp-llm-top-10-2025.rules.ts";
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

function setup(options: { templates?: SuiteTemplate[] } = {}) {
  let next = 0;
  const create = vi.fn().mockImplementation(async () => ({ id: `scenario_${++next}` }));
  const createTestSuite = vi
    .fn()
    .mockResolvedValue({ id: "suite_1", slug: "owasp", name: "OWASP" });
  const batchArchive = vi.fn().mockResolvedValue({ archived: [], failed: [] });
  const archiveTestSuite = vi.fn().mockResolvedValue({ id: "suite_1" });
  const scenarios = createApiFixture<SuiteTemplateServiceOptions["scenarios"]>({
    create,
    createTestSuite,
    batchArchive,
    archiveTestSuite,
  });
  const service = SuiteTemplateService.create({
    scenarios,
    ...(options.templates ? { templates: options.templates } : {}),
  });
  return { service, create, createTestSuite, batchArchive, archiveTestSuite };
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

  describe("when the template has more scenarios than the plan's scenario cap", () => {
    /** @scenario "Applying a template marks its scenarios so the plan's scenario cap skips them" */
    it("creates every scenario marked with the template as its source", async () => {
      const { service, create } = setup();
      const applied = await service.applyTemplate(
        { projectId: "project_1", templateId: "owasp-llm-top-10-2025", fit },
        by,
      );
      expect(applied.scenarioIds).toHaveLength(10);
      for (const call of create.mock.calls) {
        expect(call[0]).toMatchObject({ testSuiteId: "suite_1" });
        expect(call[2]).toEqual({ sourceTemplateId: "owasp-llm-top-10-2025" });
      }
    });
  });

  describe("when a scenario write fails part way through", () => {
    /** @scenario "A failed scenario write archives the half-built suite" */
    it("archives the suite and the scenarios already written, then rethrows", async () => {
      const { service, create, batchArchive, archiveTestSuite } = setup();
      create
        .mockResolvedValueOnce({ id: "scenario_a" })
        .mockResolvedValueOnce({ id: "scenario_b" })
        .mockRejectedValueOnce(new Error("store down"));

      await expect(
        service.applyTemplate(
          { projectId: "project_1", templateId: "owasp-llm-top-10-2025", fit },
          by,
        ),
      ).rejects.toThrow("store down");

      expect(batchArchive).toHaveBeenCalledWith({
        projectId: "project_1",
        ids: ["scenario_a", "scenario_b"],
      });
      expect(archiveTestSuite).toHaveBeenCalledWith({
        projectId: "project_1",
        testSuiteId: "suite_1",
      });
    });
  });

  describe("when a scenario write fails and the scenario cleanup rejects too", () => {
    /** @scenario "A failed scenario write archives the half-built suite" */
    it("still archives the suite and rethrows the original create error", async () => {
      const { service, create, batchArchive, archiveTestSuite } = setup();
      create
        .mockResolvedValueOnce({ id: "scenario_a" })
        .mockRejectedValueOnce(new Error("store down"));
      batchArchive.mockRejectedValueOnce(new Error("archive down"));

      await expect(
        service.applyTemplate(
          { projectId: "project_1", templateId: "owasp-llm-top-10-2025", fit },
          by,
        ),
      ).rejects.toThrow("store down");

      expect(archiveTestSuite).toHaveBeenCalledWith({
        projectId: "project_1",
        testSuiteId: "suite_1",
      });
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
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ code: "too_small", path: ["fit", "agentName"] })],
      });
      expect(createTestSuite).not.toHaveBeenCalled();
    });
  });

  describe("when a key with no person behind it applies a template", () => {
    /** @scenario "A template applied with a key that names no person writes no author" */
    it("writes every scenario with no author instead of the key's id", async () => {
      const { service, create } = setup({ templates: [archetype] });
      await service.applyTemplate(
        { projectId: "project_1", templateId: archetype.id, fit },
        { id: "project_1", label: "api" },
        { userId: null, label: "api" },
      );

      expect(create).toHaveBeenCalled();
      for (const call of create.mock.calls) {
        expect(call[0]).toMatchObject({ actor: { userId: null, label: "api" } });
      }
    });
  });
});
