import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/* Runs the audit CLI with this script's arguments and checks what it covered; the flags are
   the CLI's own (`--out-dir`, `--form-factors`, `--runs`, `--report-dir`, `--skip-static`). */
const runner = fileURLToPath(new URL("../src/site/audit/run.ts", import.meta.url));
const args = process.argv.slice(2);
const { values } = parseArgs({
  args,
  strict: false,
  options: { "report-dir": { type: "string" }, "skip-static": { type: "boolean" } },
});
const reportDir =
  typeof values["report-dir"] === "string"
    ? values["report-dir"]
    : await mkdtemp(path.join(os.tmpdir(), "docs-audit-"));

/** @scenario "Audit representative pages in a real browser" */
void it("audits every representative page within budget", async () => {
  const forwarded =
    typeof values["report-dir"] === "string" ? args : [...args, "--report-dir", reportDir];
  const result = spawnSync(process.execPath, [runner, ...forwarded], { stdio: "inherit" });
  const reportFile = path.join(reportDir, "audit-report.json");
  assert.ok(existsSync(reportFile), `the audit stopped (exit ${result.status}); see its output`);
  const report = JSON.parse(await readFile(reportFile, "utf8"));
  const budgets = JSON.parse(
    await readFile(new URL("../src/site/audit/budgets.json", import.meta.url), "utf8"),
  );
  const devices = new Set(report.runs.map((run) => run.formFactor));
  for (const page of budgets.pages)
    for (const device of devices)
      assert.ok(
        report.runs.some(
          (run) => run.page === page.id && run.formFactor === device && !run.runtimeError,
        ),
        `${page.id} ${device} was audited`,
      );
  if (!values["skip-static"]) assert.ok(report.seo.pages > 0, "the static checks read the sitemap");
  assert.deepEqual(
    report.seo.failures.filter((issue) => issue.code === "markdown-content-type"),
    [],
    "Markdown exports are served as text/markdown",
  );
  assert.deepEqual([...report.failures, ...report.seo.failures], []);
  assert.equal(result.status, 0);
});
