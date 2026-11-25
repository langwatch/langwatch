// The upgrade lab's dashboard section from the cell's report.json (tools/upgradelab/cell/report.go)
// and exit code (cell/command.go). Spec: specs/ci/nightly-suite.feature
//   node --experimental-strip-types .github/scripts/nightly-upgrade-lab.ts --cell <name> \
//     --run-dir "$RUNNER_TEMP/cell" --exit-code 1 --markdown upgrade-lab.md
//   ... --verdict --known-failing B1,N4,I5:inconclusive   exits 1 when the night is red

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface CellReport {
  cell?: string;
  release?: string;
  headCommit?: string;
  error?: string;
  verdicts?: { id: string; name: string; result: string; detail?: string }[];
}

const VERDICT: Record<number, string> = {
  0: "every invariant passed",
  1: "an invariant did not pass",
  2: "a step stopped the cell before it could judge the upgrade",
};

/** One cell: what it upgraded, its verdict, and every invariant that did not pass. */
export const renderUpgradeCell = ({
  cell,
  exitCode,
  report,
}: {
  cell: string;
  exitCode: number;
  report: CellReport | null;
}): string => {
  const out = [`### ${cell}`, ""];
  if (report === null) {
    out.push(
      `No report.json (exit ${exitCode}): the cell did not get far enough to write one. The job log says why.`,
      "",
    );
    return out.join("\n");
  }
  out.push(
    `From \`${report.release ?? "?"}\` to head \`${(report.headCommit ?? "?").slice(0, 10)}\`: ${VERDICT[exitCode] ?? `exit ${exitCode}`}.`,
    "",
  );
  if (report.error) out.push(`Stopped: ${report.error}`, "");
  const verdicts = report.verdicts ?? [];
  const failing = verdicts.filter((verdict) => verdict.result !== "pass");
  out.push(`${verdicts.length - failing.length} of ${verdicts.length} invariants passed.`, "");
  if (failing.length > 0) {
    out.push("| invariant | result | detail |", "| --- | --- | --- |");
    for (const verdict of failing)
      out.push(
        `| ${verdict.id} ${verdict.name} | ${verdict.result} | ${(verdict.detail ?? "").replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
      );
    out.push("");
  }
  return out.join("\n");
};

/**
 * Why the job goes red, or undefined when it stays green. `knownFailing` names what cannot pass
 * on a hosted runner yet (dev/docs/nightly-suite.md): `B1` excuses any result, `I5:inconclusive`
 * only that one. Any other result that is not `pass`, or a cell that could not judge, is red.
 */
export const upgradeLabFailure = ({
  exitCode,
  report,
  knownFailing,
}: {
  exitCode: number;
  report: CellReport | null;
  knownFailing: readonly string[];
}): string | undefined => {
  if (exitCode === 0) return undefined;
  if (report === null || exitCode !== 1) return VERDICT[2];
  const excused = ({ id, result }: { id: string; result: string }) =>
    knownFailing.includes(id) || knownFailing.includes(`${id}:${result}`);
  const failed = (report.verdicts ?? [])
    .filter((verdict) => verdict.result !== "pass" && !excused(verdict))
    .map((verdict) => verdict.id);
  return failed.length > 0 ? `${failed.join(", ")} did not pass` : undefined;
};

const option = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const args = process.argv.slice(2);
  const runDir = option(args, "run-dir") ?? ".";
  const reportPath = join(runDir, "report.json");
  const report = existsSync(reportPath)
    ? (JSON.parse(readFileSync(reportPath, "utf8")) as CellReport)
    : null;
  const exitCode = Number(option(args, "exit-code") ?? "2");
  if (args.includes("--verdict")) {
    const knownFailing = (option(args, "known-failing") ?? "").split(",").filter(Boolean);
    const failure = upgradeLabFailure({ exitCode, report, knownFailing });
    console.log(failure ?? `green; known to fail on a hosted runner: ${knownFailing.join(", ")}`);
    process.exit(failure === undefined ? 0 : 1);
  }
  const section = [
    "## Upgrade lab",
    "",
    "A seeded deployment upgraded from the last release to head under traffic, judged on its invariants. Report, screenshots and logs are the run's `upgrade-lab-*` artifact.",
    "",
    renderUpgradeCell({
      cell: option(args, "cell") ?? "cell",
      exitCode,
      report,
    }),
  ].join("\n");
  writeFileSync(option(args, "markdown") ?? "upgrade-lab.md", section);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, section);
}
