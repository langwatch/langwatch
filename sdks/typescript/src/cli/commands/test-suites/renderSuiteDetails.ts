import chalk from "chalk";
import type {
  EvaluatorAttachment,
  ScenarioMapping,
  SuiteFieldDefinition,
} from "@/client-sdk/services/test-suites";

/**
 * The human rendering of a suite's fields and evaluators, shared by the
 * commands that print a suite or a plan.
 */

/** A mapping as one short path: `scenario.fields.golden_sql` or `"literal"`. */
export const describeMapping = (mapping: ScenarioMapping): string =>
  mapping.type === "value"
    ? JSON.stringify(mapping.value)
    : `${mapping.sourceId}.${mapping.path.join(".")}`;

export function printSuiteFields(fields: SuiteFieldDefinition[] | undefined): void {
  if (!fields || fields.length === 0) return;
  console.log();
  console.log(chalk.bold("  Fields:"));
  for (const field of fields) {
    console.log(
      `    ${chalk.gray("•")} ${field.identifier} ${chalk.gray(`(${field.type})`)}`,
    );
  }
}

export function printEvaluators(
  evaluators: EvaluatorAttachment[] | undefined,
  options?: { names?: Map<string, string> },
): void {
  if (!evaluators || evaluators.length === 0) return;
  console.log();
  console.log(chalk.bold("  Evaluators:"));
  for (const attachment of evaluators) {
    const name = options?.names?.get(attachment.evaluatorId);
    const label = name
      ? `${name} ${chalk.gray(`(${attachment.evaluatorId})`)}`
      : attachment.evaluatorId;
    const gate = attachment.required
      ? chalk.red("required")
      : chalk.gray("reports only");
    console.log(`    ${chalk.gray("•")} ${label} ${chalk.gray("·")} ${gate}`);
    for (const [input, mapping] of Object.entries(attachment.mappings)) {
      console.log(
        `        ${chalk.gray(`${input}:`)} ${chalk.cyan(describeMapping(mapping))}`,
      );
    }
  }
}
