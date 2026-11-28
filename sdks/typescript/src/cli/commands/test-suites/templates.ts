import chalk from "chalk";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliTestSuitesService } from "./cli-test-suites-service";

/**
 * Lists the suite templates: everyday archetypes and red team packs.
 *
 * @see modules/suite/specs/suite-templates.feature
 */
export const listSuiteTemplatesCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  const spinner = createSpinner("Fetching suite templates...").start();

  try {
    const templates = await service.listTemplates();

    spinner.succeed(`Found ${templates.length} suite template${templates.length !== 1 ? "s" : ""}`);

    return {
      data: templates,
      table: () => {
        console.log();
        formatTable({
          data: templates.map((template) => ({
            ID: template.id,
            Title: template.title,
            Kind: template.kind === "red_team_pack" ? "red team" : "archetype",
            Scenarios: `${template.scenarios.length}`,
          })),
          headers: ["ID", "Title", "Kind", "Scenarios"],
          colorMap: { ID: chalk.green, Title: chalk.cyan },
        });
        console.log();
        console.log(
          chalk.gray(
            `Apply one with ${chalk.cyan('langwatch test-suite apply-template <id> --agent-name "Support bot"')}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "list suite templates" });
    process.exit(1);
  }
};

/**
 * Creates a test suite from a template, fitted to the agent under test: its
 * name, its tools and what it must never do.
 *
 * @see modules/suite/specs/suite-templates.feature
 */
export const applySuiteTemplateCommand = async ({
  templateId,
  agentName,
  tools,
  mustNever,
  name,
}: {
  templateId: string;
  agentName: string;
  tools?: string[];
  mustNever?: string[];
  name?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  const spinner = createSpinner(`Applying suite template "${templateId}"...`).start();

  try {
    const applied = await service.applyTemplate({
      templateId,
      body: {
        fit: { agentName, tools: tools ?? [], mustNever: mustNever ?? [] },
        ...(name !== undefined && { name }),
      },
    });

    spinner.succeed(
      `Test suite "${applied.name}" created with ${applied.scenarioIds.length} scenario${applied.scenarioIds.length !== 1 ? "s" : ""}`,
    );

    return {
      data: applied,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")} ${chalk.green(applied.suiteId)}`);
        console.log(`  ${chalk.gray("Slug:")} ${chalk.yellow(applied.slug)}`);
        console.log();
        console.log(
          chalk.gray(
            `Run it with ${chalk.cyan(`langwatch test-suite run ${applied.suiteId} --target http:<agentId>`)}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "apply suite template" });
    process.exit(1);
  }
};
