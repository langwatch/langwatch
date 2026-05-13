import chalk from "chalk";
import ora from "ora";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listProjectsCommand = async (options?: {
  page?: number;
  limit?: number;
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const service = new ProjectsApiService();
  const spinner = ora("Fetching projects...").start();

  try {
    const result = await service.list({ page: options?.page, limit: options?.limit });

    spinner.succeed(`Found ${result.data.length} project${result.data.length !== 1 ? "s" : ""} (page ${result.pagination.page}/${result.pagination.totalPages})`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.data.length === 0) {
      console.log();
      console.log(chalk.gray("No projects yet."));
      console.log(chalk.gray("Create one with:"));
      console.log(chalk.cyan('  langwatch projects create --name "my-project" --language python --framework langchain --new-team-name "my-team"'));
      return;
    }

    console.log();

    const tableData = result.data.map((p) => ({
      ID: p.id,
      Name: p.name,
      Slug: p.slug,
      Language: p.language,
      Framework: p.framework,
      Created: new Date(p.createdAt).toLocaleDateString(),
    }));

    formatTable({
      data: tableData,
      headers: ["ID", "Name", "Slug", "Language", "Framework", "Created"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.gray,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch projects get <id>")} to see full project details.`,
      ),
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch projects" });
    process.exit(1);
  }
};
