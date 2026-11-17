import type { ScenarioApi, ScenarioCaller } from "@langwatch/scenario-contract";
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
  scenarios: Pick<ScenarioApi, "assertScenarioCreationAllowed" | "createTestSuite" | "create">;
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
   * Checks the plan cap for every scenario before writing anything, then creates the test suite
   * and files each filled scenario in it.
   * @throws SuiteTemplateNotFoundError, LimitExceededError (`scenarios`)
   */
  async applyTemplate(
    input: ApplySuiteTemplateTrpcInput,
    by: ScenarioCaller,
  ): Promise<AppliedSuiteTemplate> {
    const parsed = applySuiteTemplateTrpcInputSchema.parse(input);
    const template = this.templates.find((candidate) => candidate.id === parsed.templateId);
    if (!template) throw new SuiteTemplateNotFoundError(parsed.templateId);

    const filled = template.scenarios.map((scenario) =>
      fillTemplateScenario({ template, scenario, fit: parsed.fit }),
    );
    await this.options.scenarios.assertScenarioCreationAllowed({
      projectId: parsed.projectId,
      additional: filled.length,
      by,
    });

    const suite = await this.options.scenarios.createTestSuite({
      projectId: parsed.projectId,
      name: parsed.name ?? template.title,
      templateId: template.id,
      templateVersion: template.version,
    });
    const scenarioIds: string[] = [];
    for (const scenario of filled) {
      const created = await this.options.scenarios.create(
        { ...scenario, projectId: parsed.projectId, testSuiteId: suite.id },
        by,
      );
      scenarioIds.push(created.id);
    }
    return { suiteId: suite.id, slug: suite.slug, name: suite.name, scenarioIds };
  }
}
