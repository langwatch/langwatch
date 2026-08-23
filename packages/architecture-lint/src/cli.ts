#!/usr/bin/env tsx
import { resolve } from "node:path";
import { formatViolation, lintWorkspace } from "./index";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const root = resolve(valueAfter("--root") ?? process.cwd());
const violations = lintWorkspace({
  root,
  declarations: !process.argv.includes("--no-declarations"),
});

if (violations.length > 0) {
  process.stderr.write(`${violations.map(formatViolation).join("\n\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("architecture-lint: package boundaries are sealed\n");
}
