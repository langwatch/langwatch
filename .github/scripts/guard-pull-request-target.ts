#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRepoRoot = ".";
const guardWorkflow = ".github/workflows/workflow-security-guard.yml";

const unsafeHeadRefPatterns = [
  "github.event.pull_request.head.sha",
  "github.event.pull_request.head.ref",
  "github.head_ref",
];

const safeGatePatterns = [
  /github\.event\.label\.name\s*==\s*['"]approved-ci['"]/,
  /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/,
  /github\.event\.pull_request\.head\.repo\.fork\s*==\s*false/,
];

type JobBlock = {
  name: string;
  startLine: number;
  indent: number;
  lines: string[];
};

const workflowFiles = (repoRoot: string): string[] => {
  const workflowDir = resolve(repoRoot, ".github/workflows");
  return readdirSync(workflowDir)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort()
    .map((file) => resolve(workflowDir, file));
};

export const jobBlocks = (lines: string[]): JobBlock[] => {
  const jobsStart = lines.findIndex((line) =>
    /^jobs:\s*(?:#.*)?$/.test(line),
  );
  if (jobsStart === -1) {
    return [];
  }

  const jobs: JobBlock[] = [];
  let current: JobBlock | undefined;
  let jobIndent: number | undefined;

  for (let index = jobsStart + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line && !line.startsWith(" ")) {
      break;
    }

    const match = /^(\s+)["']?([A-Za-z0-9_-]+)["']?:\s*(?:#.*)?$/.exec(line);
    const indent = match?.[1]?.length;
    if (
      match?.[2] &&
      indent !== undefined &&
      (jobIndent === undefined || indent === jobIndent)
    ) {
      jobIndent ??= indent;
      if (current) {
        jobs.push(current);
      }
      current = { name: match[2], startLine: index + 1, indent, lines: [line] };
      continue;
    }

    current?.lines.push(line);
  }

  if (current) {
    jobs.push(current);
  }

  return jobs;
};

const stripYamlComment = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.startsWith("#")) {
    return "";
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
};

export const usesPullRequestTarget = (lines: string[]): boolean =>
  lines.some((line) =>
    /(^|[{,\s])pull_request_target\s*:/.test(stripYamlComment(line)),
  );

const hasUnsafeCheckout = (jobText: string): boolean =>
  jobText.includes("actions/checkout") &&
  unsafeHeadRefPatterns.some((pattern) => jobText.includes(pattern));

export const hasSensitivePermissions = (text: string): boolean => {
  const uncommentedText = text
    .split(/\r?\n/)
    .map(stripYamlComment)
    .join("\n");

  return [
    /(^|\n)permissions:\s*write-all\b/,
    /(^|\n)contents:\s*write\b/,
    /(^|\n)pull-requests:\s*write\b/,
  ].some((pattern) => pattern.test(uncommentedText));
};

export const usesNonGithubTokenSecret = (text: string): boolean =>
  /secrets\.(?!GITHUB_TOKEN\b)[A-Za-z0-9_]+/.test(text);

export const jobIfExpression = (job: JobBlock): string | undefined => {
  const fieldPattern = new RegExp(
    `^(\\s{${job.indent + 1},})([A-Za-z0-9_-]+):\\s*`,
  );
  const fieldIndent = job.lines.reduce<number | undefined>((minimum, line) => {
    const match = fieldPattern.exec(line);
    const indent = match?.[1]?.length;
    return indent === undefined || (minimum !== undefined && minimum <= indent)
      ? minimum
      : indent;
  }, undefined);
  if (fieldIndent === undefined) {
    return undefined;
  }

  const ifPattern = new RegExp(`^\\s{${fieldIndent}}if:\\s*`);
  const fieldBoundaryPattern = new RegExp(`^\\s{${fieldIndent}}\\S`);
  const ifStart = job.lines.findIndex((line) => ifPattern.test(line));
  if (ifStart === -1) {
    return undefined;
  }

  const firstLine = job.lines[ifStart] ?? "";
  const firstValue = stripYamlComment(firstLine.replace(ifPattern, ""));
  const ifLines =
    /^(?:[>|][+-]?)?$/.test(firstValue) || firstValue === ""
      ? []
      : [firstValue];

  for (let index = ifStart + 1; index < job.lines.length; index++) {
    const line = job.lines[index] ?? "";
    if (fieldBoundaryPattern.test(line)) {
      break;
    }

    const value = stripYamlComment(line);
    if (value) {
      ifLines.push(value);
    }
  }

  return ifLines.join("\n");
};

export const hasSafeGate = (job: JobBlock): boolean => {
  const ifExpression = jobIfExpression(job);
  return ifExpression !== undefined
    ? safeGatePatterns.some((pattern) => pattern.test(ifExpression))
    : false;
};

const validateGuardWorkflow = (repoRoot: string, errors: string[]): void => {
  const path = resolve(repoRoot, guardWorkflow);
  const text = readFileSync(path, "utf8");
  const requiredSnippets = [
    "pull_request:",
    '".github/workflows/*.yml"',
    '".github/workflows/*.yaml"',
    ".github/scripts/guard-pull-request-target.ts",
  ];

  for (const snippet of requiredSnippets) {
    if (!text.includes(snippet)) {
      errors.push(`${guardWorkflow}: missing required guard trigger \`${snippet}\``);
    }
  }
};

const displayPath = (repoRoot: string, path: string): string =>
  relative(resolve(repoRoot), path) || path;

const main = (): number => {
  const repoRoot = process.argv[2] ?? defaultRepoRoot;
  const errors: string[] = [];

  validateGuardWorkflow(repoRoot, errors);

  for (const path of workflowFiles(repoRoot)) {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    if (!usesPullRequestTarget(lines)) {
      continue;
    }

    const workflowHasSensitivePermissions = hasSensitivePermissions(
      lines.join("\n"),
    );

    for (const job of jobBlocks(lines)) {
      const jobText = job.lines.join("\n");
      const risks = [
        hasUnsafeCheckout(jobText) ? "checks out PR-head code" : undefined,
        workflowHasSensitivePermissions || hasSensitivePermissions(jobText)
          ? "has write permissions"
          : undefined,
        usesNonGithubTokenSecret(jobText)
          ? "uses non-GITHUB_TOKEN secrets"
          : undefined,
      ].filter((risk) => risk !== undefined);

      if (risks.length > 0 && !hasSafeGate(job)) {
        errors.push(
          `${displayPath(repoRoot, path)}:${job.startLine}: job \`${job.name}\` ${risks.join(", ")} ` +
            "from pull_request_target without an `approved-ci` or same-repo gate",
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error("Unsafe pull_request_target workflow pattern found:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  console.log("pull_request_target workflow guard passed");
  return 0;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  process.exitCode = main();
}
