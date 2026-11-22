import { checkHtmlLinks } from "../link-check.ts";
import { checkAgentOutputs, checkSitemap } from "./agent-outputs.ts";
import { readBuildIndex } from "./build-index.ts";
import { checkLedger, readLedger } from "./ledger.ts";
import { checkRedirectRules } from "./redirect-rules.ts";
import type { LinkIssue } from "./resolve.ts";
import { checkSnippets } from "./snippets.ts";

export type CheckName = "html" | "ledger" | "redirects" | "agent-outputs" | "sitemap" | "snippets";
export type ReportedIssue = LinkIssue & { check: CheckName };

/** Every gating link check over one build; external links are a separate, optional pass. */
export function runLinkChecks({
  outDir,
  basePath,
  docsRoot,
  ledgerFile,
}: {
  outDir: string;
  basePath: string;
  docsRoot: string;
  ledgerFile: string;
}) {
  const started = performance.now();
  const index = readBuildIndex({ outDir, basePath });
  const ledger = checkLedger({ index, ledger: readLedger({ file: ledgerFile }) });
  const entries: [CheckName, { checked: number; issues: LinkIssue[] }][] = [
    ["html", checkHtmlLinks({ index })],
    ["ledger", ledger],
    ["redirects", checkRedirectRules({ index })],
    ["agent-outputs", checkAgentOutputs({ index })],
    ["sitemap", checkSitemap({ index })],
    ["snippets", checkSnippets({ docsRoot })],
  ];
  return {
    index,
    unlisted: ledger.unlisted,
    report: {
      basePath,
      pages: index.pages.length,
      htmlFiles: index.html.size,
      checked: Object.fromEntries(entries.map(([name, result]) => [name, result.checked])),
      broken: entries.reduce((total, [, result]) => total + result.issues.length, 0),
      durationMs: Math.round(performance.now() - started),
      issues: entries.flatMap(([check, result]) =>
        result.issues.map((issue): ReportedIssue => ({ check, ...issue })),
      ),
    },
  };
}
