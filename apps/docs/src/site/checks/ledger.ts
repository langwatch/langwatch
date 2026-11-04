import { readFileSync, writeFileSync } from "node:fs";

import type { BuildIndex } from "./build-index.ts";
import { checkTarget, resolveTarget, type LinkIssue } from "./resolve.ts";

/** The ledger's site paths: one per line, `#` comments and blank lines ignored. */
export function readLedger({ file }: { file: string }) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** Whether a published path still reaches a page, directly or through redirects. */
function ledgerIssue({ path, index }: { path: string; index: BuildIndex }) {
  const href = `${index.basePath}${path}`;
  const target = resolveTarget({ href, source: "/", index });
  if ("external" in target) return null;
  if ("error" in target) return target.error;
  const code = checkTarget({ index, url: target.url });
  return code === "missing-target" ? "unpublished" : code;
}

/** Each ledger path must resolve in the build, and each built page must be in the ledger. */
export function checkLedger({ index, ledger }: { index: BuildIndex; ledger: string[] }) {
  const listed = new Set(ledger);
  const issues: LinkIssue[] = [];
  for (const path of ledger) {
    const code = ledgerIssue({ path, index });
    if (code) issues.push({ source: "published-urls.txt", href: path, code });
  }
  const unlisted = index.pages.filter((page) => !listed.has(page));
  for (const page of unlisted)
    issues.push({ source: "published-urls.txt", href: page, code: "unlisted-page" });
  return { checked: ledger.length + index.pages.length, issues, unlisted };
}

/** Appends paths to the ledger, keeping its header and one sorted, unique path list. */
export function updateLedger({ file, add }: { file: string; add: string[] }) {
  const lines = readFileSync(file, "utf8").split("\n");
  const header = lines.filter((line) => line.startsWith("#"));
  const paths = [...new Set([...readLedger({ file }), ...add])].toSorted();
  writeFileSync(file, `${[...header, ...paths].join("\n")}\n`);
  return paths.length;
}
