import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { renameWorkspaceReference } from "./workspace-package-rename";

const USAGE = `Usage:
  pnpm refactor:rename-package --from OLD --to NEW [--write] [--all-string-literals] FILE...

TypeScript and JavaScript module specifiers are changed through the TypeScript
compiler API. JSON string values are changed through the TypeScript JSON AST.
Other explicitly listed files receive literal, non-regex replacements. Without
--write the command prints a dry-run summary.`;

function parseArguments(argv: string[]): {
  from: string;
  to: string;
  write: boolean;
  root: string;
  allStringLiterals: boolean;
  files: string[];
} {
  let from: string | undefined;
  let to: string | undefined;
  let write = false;
  let root = process.cwd();
  let allStringLiterals = false;
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--from") from = argv[++index];
    else if (value === "--to") to = argv[++index];
    else if (value === "--root") root = resolve(argv[++index] ?? ".");
    else if (value === "--write") write = true;
    else if (value === "--all-string-literals") allStringLiterals = true;
    else if (value === "--") continue;
    else if (value === "--help" || value === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (value?.startsWith("-")) {
      throw new Error(`Unknown option ${value}`);
    } else if (value) {
      files.push(value);
    }
  }
  if (!from || !to || files.length === 0) throw new Error(USAGE);
  return { from, to, write, root, allStringLiterals, files };
}

try {
  const options = parseArguments(process.argv.slice(2));
  let changed = 0;
  for (const input of options.files) {
    const file = resolve(options.root, input);
    const source = readFileSync(file, "utf8");
    const output = renameWorkspaceReference({
      file,
      source,
      from: options.from,
      to: options.to,
      allStringLiterals: options.allStringLiterals,
    });
    if (output === source) continue;
    changed += 1;
    process.stdout.write(
      `${options.write ? "updated" : "would update"} ${relative(options.root, file)}\n`,
    );
    if (options.write) writeFileSync(file, output, "utf8");
  }
  process.stdout.write(
    `${changed} file${changed === 1 ? "" : "s"} ${options.write ? "updated" : "would change"}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
