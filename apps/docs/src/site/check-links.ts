import { writeFileSync } from "node:fs";
import path from "node:path";

import { readBuildOptions } from "../paths.ts";
import { checkLinks } from "./link-check.ts";

const { outDir } = readBuildOptions();
const result = checkLinks({ outDir });
writeFileSync(path.join(outDir, "link-report.json"), JSON.stringify(result, null, 2));
console.log(
  `[docs-links] ${result.pages} pages, ${result.checked} links, ${result.issues.length} broken`,
);
for (const issue of result.issues.slice(0, 30))
  console.error(`${issue.code}: ${issue.source} -> ${issue.href}`);
if (result.issues.length > 0) process.exitCode = 1;
