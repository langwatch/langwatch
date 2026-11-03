import chalk from "chalk";

import type { CommandResult } from "./output";

/** One version row as the agents and evaluators version lists answer it. */
export type VersionRow = {
  version: number;
  commitMessage: string | null;
  authorKind?: string | null;
  author?: { name: string | null; email: string | null } | null;
  createdAt: string;
  labels: string[];
};

/** A label and a version read from a flag: a positive integer, or nothing. */
export const parseVersionFlag = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    console.error(chalk.red("Error: --version must be a positive integer"));
    process.exit(1);
  }
  return Number(value);
};

/** The `label` and `version` a `get` sends; neither reads the latest. */
export const versionSelectorOf = (options: {
  label?: string;
  version?: string;
}): { label?: string; version?: number } => {
  const version = parseVersionFlag(options.version);
  return {
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(version !== undefined ? { version } : {}),
  };
};

const authorOf = (row: VersionRow): string => {
  if (row.author) return row.author.name ?? row.author.email ?? "unknown user";
  return row.authorKind === "api_key" ? "API key" : "LangWatch";
};

/** The version list as a command result: newest first, labels beside each version. */
export const versionListResult = (input: {
  name: string;
  versions: VersionRow[];
}): CommandResult => ({
  data: input.versions,
  table: () => {
    console.log();
    console.log(chalk.bold.cyan(`${input.name} versions`));
    console.log(chalk.gray("─".repeat(40)));
    for (const row of input.versions) {
      const labels = row.labels.length > 0 ? ` ${chalk.green(`[${row.labels.join(", ")}]`)}` : "";
      const message = row.commitMessage ? ` ${row.commitMessage}` : "";
      console.log(`  ${chalk.bold(`v${row.version}`)}${labels}${message}`);
      console.log(
        `    ${chalk.gray(`${authorOf(row)} · ${new Date(row.createdAt).toLocaleString()}`)}`,
      );
    }
    console.log();
  },
});

/** The answer of a deploy: which label now points at which version. */
export const deployResult = (input: {
  name: string;
  label: string;
  version: number;
}): CommandResult => ({
  data: { label: input.label, version: input.version },
  table: () =>
    console.log(chalk.green(`✓ ${input.label} now points at ${input.name} v${input.version}`)),
});

export const undeployResult = (input: { name: string; label: string }): CommandResult => ({
  data: { label: input.label, removed: true },
  table: () => console.log(chalk.green(`✓ Removed ${input.label} from ${input.name}`)),
});
