import { relative, resolve } from "node:path";
import { applyFilenameMigration, planFilenameMigration } from "./filename-migration";

const USAGE = `Usage:
  pnpm --filter @langwatch/architecture-lint exec tsx src/rename-feature-sources.cli.ts [--root ROOT] [--write]

The command is dry-run by default. It prints the strict filename mapping and
the TypeScript/JSON/docs files whose exact relative references would change. Use
--write only after reviewing the collision-free plan.`;

let root = process.cwd();
let write = false;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--") continue;
  if (argument === "--root") root = resolve(process.argv[++index] ?? ".");
  else if (argument === "--write") write = true;
  else if (argument === "--help" || argument === "-h") {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  } else if (argument?.startsWith("-")) {
    throw new Error(`Unknown option ${argument}\n${USAGE}`);
  }
}

try {
  const plan = planFilenameMigration(root);
  process.stdout.write(
    `${plan.mappings.length} filename mapping${plan.mappings.length === 1 ? "" : "s"}\n`,
  );
  for (const mapping of plan.mappings) {
    process.stdout.write(`${relative(root, mapping.from)} -> ${relative(root, mapping.to)}\n`);
  }
  process.stdout.write(
    `${plan.edits.size} reference file${plan.edits.size === 1 ? "" : "s"} would change\n`,
  );
  if (plan.collisions.length) {
    process.stderr.write(`Collisions:\n${plan.collisions.join("\n")}\n`);
  }
  if (plan.unresolved.length) {
    process.stderr.write(`Unresolved mappings:\n${plan.unresolved.join("\n")}\n`);
  }
  if (plan.remainingTextualReferences.length) {
    process.stderr.write(
      `Remaining documentation references:\n${plan.remainingTextualReferences.join("\n")}\n`,
    );
  }
  if (plan.collisions.length || plan.unresolved.length || plan.remainingTextualReferences.length) {
    process.exitCode = 1;
  } else if (write) {
    applyFilenameMigration(plan);
    process.stdout.write(
      `Applied ${plan.mappings.length} filename mapping${plan.mappings.length === 1 ? "" : "s"}.\n`,
    );
  } else {
    process.stdout.write("Dry run only; pass --write to apply this plan.\n");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 1;
}
