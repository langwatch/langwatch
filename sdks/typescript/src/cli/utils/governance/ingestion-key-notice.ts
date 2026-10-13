import chalk from "chalk";

/**
 * What a project login prints when it could only write the ingestion key: the key sends traces
 * and nothing else, and where a key that does more comes from.
 */
export function printIngestionKeyNotice(project: { name: string; slug: string }): void {
  console.log(
    chalk.yellow(
      `  This key only sends traces. A key that also reads and writes prompts, datasets, evaluations and simulations needs project:manage on ${project.name}: ask a project admin for it.`,
    ),
  );
  console.log(
    chalk.gray("  Meanwhile, commands run as you with ") +
      chalk.cyan("langwatch login --device") +
      chalk.gray(" and ") +
      chalk.cyan(`--project ${project.slug}`),
  );
}
