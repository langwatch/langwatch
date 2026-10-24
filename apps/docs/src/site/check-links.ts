import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { DOCS_URL } from "../lib/site-path.ts";
import { appRoot, cacheRoot, docsRoot, readBuildOptions } from "../paths.ts";
import { sitemapLocations } from "./checks/agent-outputs.ts";
import { checkExternalLinks, externalLinks } from "./checks/external-links.ts";
import { checkLedger, updateLedger } from "./checks/ledger.ts";
import { runLinkChecks } from "./checks/run-checks.ts";

/* Usage: test:links --out-dir <dist> [--base-path /docs] [--update-ledger] [--live] [--external]
   [--report <file>]. Gating checks always run; --live and --external only report. */
const { values } = parseArgs({
  options: {
    "out-dir": { type: "string" },
    "base-path": { type: "string" },
    report: { type: "string" },
    "update-ledger": { type: "boolean" },
    live: { type: "boolean" },
    external: { type: "boolean" },
  },
});
const { outDir, basePath } = readBuildOptions({
  args: [
    ...(values["out-dir"] ? ["--out-dir", values["out-dir"]] : []),
    ...(values["base-path"] ? ["--base-path", values["base-path"]] : []),
  ],
});
const ledgerFile = path.join(appRoot, "specs/published-urls.txt");
const LIVE_SITEMAP = `${DOCS_URL}/sitemap.xml`;

const { index, unlisted, report } = runLinkChecks({ outDir, basePath, docsRoot, ledgerFile });
let issues = report.issues;
if (values["update-ledger"] && unlisted.length > 0) {
  const total = updateLedger({ file: ledgerFile, add: unlisted });
  console.log(`[docs-links] added ${unlisted.length} pages to the ledger (${total} paths)`);
  issues = issues.filter((issue) => issue.code !== "unlisted-page");
}

const extras: Record<string, unknown> = {};
if (values.live) {
  const xml = await (await fetch(LIVE_SITEMAP)).text();
  const live = sitemapLocations({ xml }).map((loc) => loc.slice(DOCS_URL.length) || "/");
  const diff = checkLedger({ index, ledger: live });
  extras.live = { pages: live.length, issues: diff.issues };
  console.log(`[docs-links] live sitemap: ${live.length} pages, ${diff.issues.length} differences`);
  for (const issue of diff.issues)
    console.log(`  ${issue.code === "unlisted-page" ? "not live yet" : issue.code}: ${issue.href}`);
}
if (values.external) {
  const links = externalLinks({ index });
  const cacheFile = path.join(cacheRoot, "docs-external-links.json");
  const external = await checkExternalLinks({ links, cacheFile });
  extras.external = external;
  console.log(
    `[docs-links] external: ${external.checked} links, ${external.failures.length} failing (not gating)`,
  );
  for (const failure of external.failures)
    console.log(
      `  ${failure.status || "unreachable"}: ${failure.href} (${failure.sources.slice(0, 3).join(", ")})`,
    );
}

const reportFile = path.resolve(values.report ?? path.join(outDir, "link-report.json"));
writeFileSync(
  reportFile,
  JSON.stringify({ ...report, broken: issues.length, issues, ...extras }, null, 2),
);
const linkCount = Object.values(report.checked).reduce((total, count) => total + count, 0);
console.log(
  `[docs-links] ${report.pages} pages, ${linkCount} links, ${issues.length} broken in ${report.durationMs} ms`,
);
for (const issue of issues.slice(0, 40))
  console.error(`${issue.check} ${issue.code}: ${issue.source} -> ${issue.href}`);
if (issues.some((issue) => issue.code === "unlisted-page"))
  console.error(
    "[docs-links] new pages must be added to apps/docs/specs/published-urls.txt: rerun with --update-ledger",
  );
if (issues.length > 0) process.exitCode = 1;
