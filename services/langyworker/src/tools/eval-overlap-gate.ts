/**
 * Refuses opening a pull request in the sandbox when the branch adds string literals the run's
 * eval material holds, unless the PR body discloses them.
 * Spec: specs/langy/langy-github-prs.feature.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";

import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

import { BASH_TOOL_NAME } from "./local-workspace.js";
import {
  pullRequestBase,
  pullRequestBodyFiles,
  pullRequestCreationIndex,
} from "./pull-request-command.js";
import { expandSandboxHome } from "./sandbox-paths.js";

/** The heading a PR body discloses matched literals under. */
export const EVAL_OVERLAP_HEADING = "Eval overlap";

const MAX_CORPUS_CHARS = 8_000_000;
const MAX_EVAL_FILE_BYTES = 1_000_000;
const MAX_REPORTED_HITS = 20;
const WEAK_HITS_TO_REFUSE = 3;
const GIT_TIMEOUT_MS = 20_000;

/** A langwatch read whose output is eval material: dataset rows, runs, scenarios. */
const EVAL_READ_COMMAND =
  /\blangwatch\s+(?:datasets?|experiments?|evaluations?|evaluators?|scenarios?|simulations?|suites?|evals?)\b/;

const EVAL_SEGMENT =
  /^(?:evals?|evaluations?|datasets?|scenarios?|benchmarks?|golden|goldens|fixtures?)$/i;
const EVAL_BASENAME = /(?:eval|scenario|dataset|golden|benchmark)/i;

/** Added lines in these files hold data or prose, not code that answers a question. */
const SKIPPED_DIFF_FILE = /(?:\.(?:md|mdx|txt|csv|tsv|jsonl|lock)|-lock\.json|-lock\.yaml)$/i;

/** Single words that are code vocabulary, never a sign of a keyed answer. */
const CODE_WORDS = new Set([
  "true",
  "false",
  "none",
  "null",
  "error",
  "bearer",
  "authorization",
  "accept",
  "content-type",
  "user",
  "assistant",
  "system",
  "tool",
  "string",
  "number",
  "object",
]);

export interface AddedLiteral {
  file: string;
  line: number;
  literal: string;
}

export interface EvalOverlap extends AddedLiteral {
  /** A phrase or a number with words; a lone proper noun or compound is weak. */
  strong: boolean;
}

/** Lowercase, single spaces, trimmed: the form both sides are compared in. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Does the command open a pull request: `gh pr create`, or a `gh api` or `curl` POST to pulls? */
export function isPrCreateCommand(command: string): boolean {
  return pullRequestCreationIndex(command) >= 0;
}

/** Is this a langwatch read whose output is eval material? */
export function isEvalReadCommand(command: string): boolean {
  return EVAL_READ_COMMAND.test(command);
}

/** Does this repository path hold evals: datasets, scenarios, eval scripts? */
export function isEvalPath(path: string): boolean {
  const segments = path.split("/");
  const base = segments.at(-1) ?? "";
  if (segments.includes("node_modules")) return false;
  return segments.slice(0, -1).some((s) => EVAL_SEGMENT.test(s)) || EVAL_BASENAME.test(base);
}

/** The folder the command runs `gh` in: its last `cd` before the call, else the home. */
export function commandCwd({ command, home }: { command: string; home: string }): string {
  const beforeGh = command.slice(0, Math.max(0, pullRequestCreationIndex(command)));
  let cwd = home;
  for (const match of beforeGh.matchAll(/(?:^|[;&|(]\s*|\s)cd\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/g)) {
    const raw = (match[1] ?? "").replace(/^["']|["']$/g, "");
    const expanded = expandSandboxHome({ path: raw, home });
    cwd = isAbsolute(expanded) ? expanded : join(cwd, expanded);
  }
  return cwd;
}

const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** Is this literal specific enough to mean something when an eval holds it too? */
export function literalStrength(literal: string): "strong" | "weak" | null {
  const text = literal.replace(/\\[nt]/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!/[A-Za-z]/.test(text)) return null;
  if (/[{}<>$%=\\]|\$\{/.test(text)) return null;
  if (words.length >= 2) return text.length >= 6 ? "strong" : null;
  if (CODE_WORDS.has(text.toLowerCase())) return null;
  // A lone word counts only as a proper noun (`Ukraine`) or a compound (`cease-fire`).
  if (/^[A-Z][a-z]{3,}(?:[-'][A-Za-z]+)*$/.test(text)) return "weak";
  if (/^[a-z]{2,}(?:-[a-z]{2,})+$/.test(text)) return "weak";
  return null;
}

/** The diff's target path, or null when its added lines are not code worth scanning. */
function scannedFile(header: string): string | null {
  const path = header.slice(4).replace(/^b\//, "");
  if (path === "/dev/null" || isEvalPath(path) || SKIPPED_DIFF_FILE.test(path)) return null;
  return path;
}

/** The literals on one added row, in the file being read. */
function rowLiterals({ row, file, line }: { row: string; file: string | null; line: number }) {
  if (file === null) return [];
  return [...row.slice(1).matchAll(STRING_LITERAL)].map((match) => ({
    file,
    line,
    literal: match[2] ?? "",
  }));
}

/** The string literals on the lines a unified diff adds, outside eval and data files. */
export function addedLiterals(diff: string): AddedLiteral[] {
  const found: AddedLiteral[] = [];
  let file: string | null = null;
  let line = 0;
  for (const row of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (row.startsWith("+++ ")) {
      file = scannedFile(row);
    } else if (hunk) {
      line = Number(hunk[1]);
    } else if (row.startsWith("+")) {
      found.push(...rowLiterals({ row, file, line }));
      line += 1;
    } else if (!row.startsWith("-") && !row.startsWith("\\")) {
      line += 1;
    }
  }
  return found;
}

/** Does `needle` occur in `haystack` with no letter or digit glued to either side? */
function containsWhole({ haystack, needle }: { haystack: string; needle: string }): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = haystack[at - 1] ?? " ";
    const after = haystack[at + needle.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/** The added literals the eval material holds too, each once. */
export function evalOverlaps({
  literals,
  corpus,
}: {
  literals: readonly AddedLiteral[];
  /** Normalised eval material. */
  corpus: string;
}): EvalOverlap[] {
  const seen = new Set<string>();
  const overlaps: EvalOverlap[] = [];
  for (const added of literals) {
    const strength = literalStrength(added.literal);
    if (strength === null) continue;
    const needle = normalise(added.literal.replace(/\\[nt]/g, " "));
    if (seen.has(needle)) continue;
    if (!containsWhole({ haystack: corpus, needle })) continue;
    seen.add(needle);
    overlaps.push({ ...added, strong: strength === "strong" });
  }
  return overlaps;
}

/** Overlaps worth stopping for: any phrase, or a run of keywords. */
export function overlapsToRefuse(overlaps: readonly EvalOverlap[]): EvalOverlap[] {
  const strong = overlaps.filter((o) => o.strong);
  const weak = overlaps.filter((o) => !o.strong);
  return weak.length >= WEAK_HITS_TO_REFUSE ? [...strong, ...weak] : strong;
}

/** Does the PR body carry the heading and quote every matched literal? */
export function isDisclosed({
  overlaps,
  body,
}: {
  overlaps: readonly EvalOverlap[];
  body: string;
}): boolean {
  const text = normalise(body);
  if (!text.includes(normalise(EVAL_OVERLAP_HEADING))) return false;
  return overlaps.every((o) => text.includes(normalise(o.literal)));
}

/** What the model reads when the pull request is refused. */
export function evalOverlapRefusal(overlaps: readonly EvalOverlap[]): string {
  const shown = overlaps.slice(0, MAX_REPORTED_HITS);
  const rows = shown.map((o) => `- ${o.file}:${o.line} "${o.literal}"`);
  const more =
    overlaps.length > shown.length ? [`- and ${overlaps.length - shown.length} more`] : [];
  return [
    "The pull request was not opened. The change adds string literals that also appear in the eval material of this run (dataset rows, experiment or scenario reads, or the repository's eval files):",
    ...rows,
    ...more,
    "Code that matches eval questions or returns their expected answers passes the evals without fixing anything, and the result does not hold on other inputs. If that is what these are, remove them, fix the class of failure, and measure again with the held-out cases.",
    `If they belong in the code (for example a deliberate few-shot example or a domain term the product needs), add a section headed "${EVAL_OVERLAP_HEADING}" to the PR body that quotes each literal above and says why it is there, then run the command again.`,
  ].join("\n");
}

export type GitRunner = (args: { cwd: string; args: readonly string[] }) => Promise<string>;

const runGit: GitRunner = ({ cwd, args }) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

async function mergeBase({
  git,
  cwd,
  base,
}: {
  git: GitRunner;
  cwd: string;
  base: string | undefined;
}): Promise<string> {
  const candidates: string[] = [];
  if (base) candidates.push(`origin/${base}`, base);
  try {
    candidates.push(
      (await git({ cwd, args: ["rev-parse", "--abbrev-ref", "origin/HEAD"] })).trim(),
    );
  } catch {
    // No remote HEAD recorded: fall through to the usual default branch names.
  }
  candidates.push("origin/main", "origin/master");
  for (const ref of candidates) {
    try {
      return (await git({ cwd, args: ["merge-base", "HEAD", ref] })).trim();
    } catch {
      // Not a ref this clone has; try the next one.
    }
  }
  throw new Error("no base branch to compare the pull request against");
}

async function repositoryEvalText({
  git,
  cwd,
  budget,
}: {
  git: GitRunner;
  cwd: string;
  budget: number;
}): Promise<string> {
  const files = (await git({ cwd, args: ["ls-files", "-z"] })).split("\0").filter(isEvalPath);
  const parts: string[] = [];
  let used = 0;
  for (const file of files) {
    if (used >= budget) break;
    try {
      const text = readFileSync(join(cwd, file), "utf8");
      if (text.length > MAX_EVAL_FILE_BYTES || text.includes("\u0000")) continue;
      parts.push(text);
      used += text.length;
    } catch {
      // A file listed but unreadable holds nothing to compare against.
    }
  }
  return parts.join("\n");
}

/** Was the literal already in the code before this branch, outside eval files? */
async function existedBefore({
  git,
  cwd,
  base,
  literal,
}: {
  git: GitRunner;
  cwd: string;
  base: string;
  literal: string;
}): Promise<boolean> {
  try {
    const listed = await git({
      cwd,
      args: ["grep", "-l", "-i", "-F", "-e", literal, base, "--"],
    });
    return listed
      .split("\n")
      .map((row) => row.replace(`${base}:`, ""))
      .some((path) => path !== "" && !isEvalPath(posix.normalize(path)));
  } catch {
    return false;
  }
}

/**
 * The refusal for a `gh pr create` command, or undefined when it may run:
 * no overlap, every overlap disclosed, or no diff to read (the check fails
 * open on a clone it cannot read, since it guards evidence, not access).
 */
export async function checkPullRequest({
  command,
  home,
  sessionCorpus,
  git = runGit,
  readBodyFile = (path) => readFileSync(path, "utf8"),
}: {
  command: string;
  home: string;
  sessionCorpus: string;
  git?: GitRunner;
  readBodyFile?: (path: string) => string;
}): Promise<string | undefined> {
  const cwd = commandCwd({ command, home });
  let base: string;
  let diff: string;
  let repoText: string;
  try {
    base = await mergeBase({ git, cwd, base: pullRequestBase(command) });
    diff = await git({
      cwd,
      args: ["diff", "--unified=0", "--no-color", "--no-ext-diff", base, "HEAD"],
    });
    repoText = await repositoryEvalText({
      git,
      cwd,
      budget: Math.max(0, MAX_CORPUS_CHARS - sessionCorpus.length),
    });
  } catch {
    return undefined;
  }

  const corpus = normalise(`${sessionCorpus}\n${repoText}`);
  if (corpus === "") return undefined;
  const found = evalOverlaps({ literals: addedLiterals(diff), corpus });
  const kept: EvalOverlap[] = [];
  for (const overlap of found) {
    if (!(await existedBefore({ git, cwd, base, literal: overlap.literal }))) kept.push(overlap);
  }
  const refused = overlapsToRefuse(kept);
  if (refused.length === 0) return undefined;

  let body = command;
  for (const bodyFile of pullRequestBodyFiles(command)) {
    try {
      body += `\n${readBodyFile(isAbsolute(bodyFile) ? bodyFile : join(cwd, bodyFile))}`;
    } catch {
      // A body file that is not there discloses nothing; the command reports it on its own.
    }
  }
  return isDisclosed({ overlaps: refused, body }) ? undefined : evalOverlapRefusal(refused);
}

function resultText(content: readonly { type: string; text?: string }[]): string {
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

/** Adds a successful langwatch eval read's output to the run's eval material. */
function collectEvalRead({
  material,
  input,
  content,
  isError,
}: {
  material: { corpus: string };
  input: Record<string, unknown>;
  content: readonly { type: string; text?: string }[];
  isError: boolean;
}): void {
  const command = input.command;
  if (isError || typeof command !== "string" || !isEvalReadCommand(command)) return;
  const room = MAX_CORPUS_CHARS - material.corpus.length;
  if (room <= 0) return;
  material.corpus += `\n${resultText(content)}`.slice(0, room);
}

export function createEvalOverlapGateExtension({
  home,
  folder,
  git,
}: {
  home: string;
  /** The developer's folder state: a connected folder runs gh on their machine, out of reach. */
  folder: { connected: boolean };
  git?: GitRunner;
}): InlineExtension {
  return {
    name: "langy-eval-overlap-gate",
    factory: (pi: ExtensionAPI) => {
      const material = { corpus: "" };
      pi.on("tool_result", async (event) => {
        collectEvalRead({
          material,
          input: event.input,
          content: event.content,
          isError: event.isError,
        });
      });

      pi.on("tool_call", async (event) => {
        if (event.toolName !== BASH_TOOL_NAME || folder.connected) return undefined;
        const command = (event.input as { command?: unknown }).command;
        if (typeof command !== "string" || !isPrCreateCommand(command)) return undefined;
        const reason = await checkPullRequest({
          command,
          home,
          sessionCorpus: material.corpus,
          git,
        });
        return reason === undefined ? undefined : { block: true, reason };
      });
    },
  };
}
