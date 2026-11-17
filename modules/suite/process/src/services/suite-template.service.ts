import {
  redTeamConfigSchema,
  type ScenarioApi,
  type ScenarioCaller,
} from "@langwatch/scenario-contract";
import {
  applySuiteTemplateTrpcInputSchema,
  SuiteTemplateNotFoundError,
  type AppliedSuiteTemplate,
  type ApplySuiteTemplateTrpcInput,
  type SuiteTemplate,
} from "@langwatch/suite-contract";

import {
  fillTemplateScenario,
  SUITE_TEMPLATES,
} from "../features/suite-templates/rules/suite-template-fill.rules.ts";

export type SuiteTemplateServiceOptions = {
  scenarios: Pick<ScenarioApi, "createTestSuite" | "create" | "batchArchive" | "archiveTestSuite">;
  templates?: readonly SuiteTemplate[];
};

/** Lists the shipped suite templates and applies one as a new test suite. */
export class SuiteTemplateService {
  static create(options: SuiteTemplateServiceOptions): SuiteTemplateService {
    return new SuiteTemplateService(options);
  }

  private constructor(private readonly options: SuiteTemplateServiceOptions) {}

  private get templates(): readonly SuiteTemplate[] {
    return this.options.templates ?? SUITE_TEMPLATES;
  }

  listTemplates(): SuiteTemplate[] {
    return [...this.templates];
  }

  /**
   * Validates every filled scenario before writing anything, then creates the test suite and
   * files each scenario in it, marked with the template so the Free scenario cap skips them.
   * A failed scenario write archives the suite and what it already holds, then rethrows.
   * @throws SuiteTemplateNotFoundError
   */
  async applyTemplate(
    input: ApplySuiteTemplateTrpcInput,
    by: ScenarioCaller,
  ): Promise<AppliedSuiteTemplate> {
    const parsed = applySuiteTemplateTrpcInputSchema.parse(input);
    const template = this.templates.find((candidate) => candidate.id === parsed.templateId);
    if (!template) throw new SuiteTemplateNotFoundError(parsed.templateId);

    const filled = template.scenarios.map((scenario) => {
      const result = fillTemplateScenario({ template, scenario, fit: parsed.fit });
      if (result.redTeam) redTeamConfigSchema.parse(result.redTeam);
      return result;
    });
    const suite = await this.options.scenarios.createTestSuite({
      projectId: parsed.projectId,
      name: parsed.name ?? template.title,
      templateId: template.id,
      templateVersion: template.version,
    });
    const scenarioIds: string[] = [];
    try {
      for (const scenario of filled) {
        const created = await this.options.scenarios.create(
          { ...scenario, projectId: parsed.projectId, testSuiteId: suite.id },
          by,
          { sourceTemplateId: template.id },
        );
        scenarioIds.push(created.id);
      }
    } catch (error) {
      await this.discardPartialSuite({
        projectId: parsed.projectId,
        suiteId: suite.id,
        scenarioIds,
      });
      throw error;
    }
    return { suiteId: suite.id, slug: suite.slug, name: suite.name, scenarioIds };
  }

  private async discardPartialSuite(input: {
    projectId: string;
    suiteId: string;
    scenarioIds: string[];
  }): Promise<void> {
    if (input.scenarioIds.length > 0) {
      await this.options.scenarios.batchArchive({
        projectId: input.projectId,
        ids: input.scenarioIds,
      });
    }
    await this.options.scenarios.archiveTestSuite({
      projectId: input.projectId,
      testSuiteId: input.suiteId,
    });
  }
}
