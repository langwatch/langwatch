// Decides whether a PR needs a `## Architecture` section and whether it fills in 'Needs a
// human look' and 'Decisions no check makes': every change architecture-decisions.ts finds
// must be named by a decision whose rule is neither a baseline nor the file that change
// loosens. Docs-only, lockfile and dependency-bot manifest changes are exempt.
// Spec: specs/ci/pr-architecture-section.feature

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type ChangedFile,
  type ContentReader,
  type DecisionTrigger,
  findDecisionTriggers,
  isBaselinePath,
  isRulePath,
  loosensItsFile,
  parseChangedFileEntries,
} from "./architecture-decisions.ts";
import { isDependencyBot, kindOf } from "./guard-deployment-impact.ts";

/** Markdown here is the record or agent instructions: a change to it is architecture. */
const RECORD_PREFIXES: readonly string[] = ["dev/docs/", ".claude/"];
const RECORD_FILES: readonly string[] = ["CLAUDE.md", "AGENTS.md"];
const MODULE_ADRS = /^(enterprise\/)?modules\/[^/]+\/adrs\//;

const isRecordPath = (path: string): boolean => {
  const name = path.split("/").pop() ?? path;
  const inRecord = RECORD_PREFIXES.some((prefix) => path.startsWith(prefix));
  return inRecord || RECORD_FILES.includes(name) || MODULE_ADRS.test(path);
};

/** The public docs site, and plain markdown that is not the architecture record. */
export const isDocsPath = (path: string): boolean => {
  if (path.startsWith("docs/")) return true;
  return /\.mdx?$/.test(path) && !isRecordPath(path);
};

const isExemptFile = ({ path, author }: { path: string; author: string }): boolean => {
  const kind = kindOf(path);
  const botBump = kind === "manifest" && isDependencyBot(author);
  return isDocsPath(path) || kind === "lockfile" || botBump;
};

/**
 * Names arrive byte-exact, as in guard-deployment-impact.ts. An empty change
 * set exempts nothing: with no files to inspect, the section is required.
 */
export const requiresSection = ({
  files,
  author,
}: {
  files: readonly string[];
  author: string;
}): boolean => files.length === 0 || !files.every((path) => isExemptFile({ path, author }));

const ARCHITECTURE_HEADING = /^##[ \t]+architecture[ \t]*#*[ \t]*$/i;
const HUMAN_LOOK_HEADING = /^(#{2,3})[ \t]+needs a human look[ \t:]*#*[ \t]*$/i;
const ANY_HEADING = /^(#{1,6})[ \t]+\S/;

/** A fence line: its marker, then the rest. A closing fence has only spaces after it. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const closesFence = ({ line, fence }: { line: string; fence: string }): boolean => {
  const match = FENCE.exec(line);
  const marker = match?.[1];
  return (
    marker?.[0] === fence[0] && marker.length >= fence.length && /^[ \t]*$/.test(match?.[2] ?? "")
  );
};

/** The part of one line outside HTML comments, and whether a comment is still open after it. */
const outsideComments = ({
  line,
  inComment,
}: {
  line: string;
  inComment: boolean;
}): { text: string; inComment: boolean } => {
  let text = "";
  let rest = line;
  let open = inComment;
  while (rest.length > 0) {
    const token = open ? "-->" : "<!--";
    const at = rest.indexOf(token);
    if (!open) text += at < 0 ? rest : rest.slice(0, at);
    if (at < 0) break;
    rest = rest.slice(at + token.length);
    open = !open;
  }
  return { text, inComment: open };
};

/**
 * The body as a reader sees it: no HTML comments, no fenced code examples.
 * One pass, so a `<!--` inside a fence stays literal and a fence inside a
 * comment stays hidden; an unclosed comment hides the rest, as GitHub renders it.
 */
const visibleLines = (body: string): string[] => {
  const visible: string[] = [];
  let fence: string | undefined;
  let inComment = false;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence !== undefined) {
      if (closesFence({ line, fence })) fence = undefined;
      continue;
    }
    const marker = inComment ? undefined : FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    const scanned = outsideComments({ line, inComment });
    const text = scanned.text;
    inComment = scanned.inComment;
    if (text.length > 0 || line.length === 0) visible.push(text);
  }
  return visible;
};

const levelOf = (line: string): number => ANY_HEADING.exec(line)?.[1]?.length ?? 0;

/** Lines after `start` up to the next heading at `level` or shallower. */
const sectionAfter = ({
  lines,
  start,
  level,
}: {
  lines: readonly string[];
  start: number;
  level: number;
}): string[] => {
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const found = levelOf(line);
    return found > 0 && found <= level;
  });
  return end === -1 ? rest : rest.slice(0, end);
};

/** What is wrong with the description, as messages telling the author what to add. */
export const checkBody = (body: string): string[] => {
  const lines = visibleLines(body);
  const errors: string[] = [];

  if (!lines.some((line) => ARCHITECTURE_HEADING.test(line))) {
    errors.push(
      "No '## Architecture' heading in the PR description. Add it as a top-level H2 (the PR template has it), with its 'Decisions no check makes' and 'Needs a human look' parts.",
    );
  }

  const look = lines.findIndex((line) => HUMAN_LOOK_HEADING.test(line));
  if (look === -1) {
    errors.push(
      "No 'Needs a human look' heading (### or ##) in the PR description. Add it and list anything unusual, outside the usual patterns, a rule bent, a new shape or a judgement call. Write 'None' if there is nothing.",
    );
  } else {
    const level = HUMAN_LOOK_HEADING.exec(lines[look] ?? "")?.[1]?.length ?? 3;
    const content = sectionAfter({ lines, start: look, level }).join("\n");
    if (!/[\p{L}\p{N}]/u.test(content)) {
      errors.push(
        "'Needs a human look' is empty. List anything unusual, outside the usual patterns, a rule bent, a new shape or a judgement call, or write 'None' if there is nothing.",
      );
    }
  }

  return errors;
};

/**
 * What the agent is told when a change makes a decision no check makes. It is
 * the whole point of the guard: the agent stops and asks, it does not decide.
 */
export const ASK_YOUR_HUMAN =
  "Do not decide this yourself. Stop and ask the human you are working for to decide: show them 2 or 3 options, the dev/docs/ARCHITECTURE.md sections and the existing code patterns that apply to each, and what each costs. Then add the lint rule or enforcer policy that encodes their answer, so the next change is decided by a check instead of a person. Record it under '### Decisions no check makes' as: '- <the decision>. Options: <A>; <B>. Human chose: <which, and why>. Rule: <path of the rule this PR adds or changes, or none - why no rule can express it>'.";

const DECISIONS_HEADING = /^(#{2,3})[ \t]+decisions no check makes[ \t:]*#*[ \t]*$/i;
const LIST_ITEM = /^[ \t]*[-*][ \t]+\S/;
const NONE = /^[ \t]*(?:[-*][ \t]+)?none\.?[ \t]*$/i;
const RULE_FIELD = /\brule:[ \t]*`?([^`\s;,]+)`?/i;

const describeTrigger = ({ kind, path, subject, detail }: DecisionTrigger): string =>
  `${kind} in ${path}: \`${subject}\` (${detail})`;

/** Whether a decision names a subject: the whole token, in backticks or plain. */
export const cites = ({ entry, subject }: { entry: string; subject: string }): boolean => {
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w/.-])${escaped}(?![\\w/-]|\\.\\w)`).test(entry);
};

/** One recorded decision: its options, the human's choice, and the rule that encodes it. */
const entryErrors = ({
  entry,
  changed,
  triggers,
}: {
  entry: string;
  changed: ReadonlySet<string>;
  triggers: readonly DecisionTrigger[];
}): string[] => {
  const missing = [
    /\boptions?:/i.test(entry) ? undefined : "'Options:'",
    /\bhuman chose:/i.test(entry) ? undefined : "'Human chose:'",
    RULE_FIELD.test(entry) ? undefined : "'Rule:'",
  ].filter((part) => part !== undefined);
  if (missing.length > 0) {
    return [`The decision '${entry.trim()}' has no ${missing.join(", ")}. ${ASK_YOUR_HUMAN}`];
  }
  const rule = RULE_FIELD.exec(entry)?.[1] ?? "";
  if (/^none$/i.test(rule)) {
    return /\brule:[ \t]*none[ \t]*[-:\u2013][ \t]*[\p{L}\p{N}]/iu.test(entry)
      ? []
      : [
          `The decision '${entry.trim()}' says 'Rule: none' without saying why. Write 'Rule: none - <why no rule can express it>'.`,
        ];
  }
  if (isBaselinePath(rule)) {
    return [
      `The decision '${entry.trim()}' names the baseline '${rule}' as its rule. A baseline is the debt a rule tolerates, not the rule. Name the rule or policy file this PR changes to encode the answer, or write 'Rule: none - <why no rule can express it>'.`,
    ];
  }
  const answered = triggers.filter(
    (trigger) =>
      loosensItsFile(trigger) &&
      trigger.path === rule &&
      cites({ entry, subject: trigger.subject }),
  );
  if (answered.length > 0) {
    return [
      `The decision '${entry.trim()}' names '${rule}' as its rule, but that is the file it loosens (${answered.map(describeTrigger).join("; ")}). Name the rule or policy file this PR changes to encode the answer, or write 'Rule: none - <why no rule can express it>'.`,
    ];
  }
  if (!changed.has(rule) || !isRulePath(rule)) {
    return [
      `The decision '${entry.trim()}' names the rule '${rule}', which this PR does not add or change under packages/oxlint-rules, packages/architecture-enforcer, a lint config or the CI gate. Name the rule file this PR changes, or write 'Rule: none - <why no rule can express it>'.`,
    ];
  }
  return [];
};

/** Each change no check decides needs a decision the human made, recorded in the description. */
export const checkDecisions = ({
  body,
  triggers,
  changed,
}: {
  body: string;
  triggers: readonly DecisionTrigger[];
  changed: ReadonlySet<string>;
}): string[] => {
  const lines = visibleLines(body);
  const heading = lines.findIndex((line) => DECISIONS_HEADING.test(line));
  const level = DECISIONS_HEADING.exec(lines[heading] ?? "")?.[1]?.length ?? 3;
  const content = heading === -1 ? [] : sectionAfter({ lines, start: heading, level });
  const entries = content.filter((line) => LIST_ITEM.test(line) && !NONE.test(line));

  if (triggers.length === 0) {
    if (heading === -1) {
      return [
        "No 'Decisions no check makes' heading (### or ##) under '## Architecture'. Add it and write 'None' when every choice in this change is decided by a lint rule or enforcer policy.",
      ];
    }
    return entries.flatMap((entry) => entryErrors({ entry, changed, triggers }));
  }
  if (entries.length === 0) {
    return [
      `This change makes decisions no lint rule or enforcer policy makes: ${triggers.map(describeTrigger).join("; ")}. ${ASK_YOUR_HUMAN}`,
    ];
  }
  const uncited = triggers.filter(
    (trigger) => !entries.some((entry) => cites({ entry, subject: trigger.subject })),
  );
  return [
    ...(uncited.length === 0
      ? []
      : [
          `No recorded decision names these changes no check decides: ${uncited.map(describeTrigger).join("; ")}. Name each subject (the part in backticks) in the decision that covers it, or record a decision for it. ${ASK_YOUR_HUMAN}`,
        ]),
    ...entries.flatMap((entry) => entryErrors({ entry, changed, triggers })),
  ];
};

export const main = ({
  files,
  author,
  body,
  read,
}: {
  files: readonly ChangedFile[];
  author: string;
  body: string;
  read?: ContentReader;
}): { required: boolean; errors: string[] } => {
  const names = files.map((file) => file.filename);
  const required = requiresSection({ files: names, author });
  if (!required) return { required, errors: [] };
  const triggers = findDecisionTriggers({ files, author, read });
  return {
    required,
    errors: [...checkBody(body), ...checkDecisions({ body, triggers, changed: new Set(names) })],
  };
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

/** Runs a command for its output, or undefined when it fails (a file missing on that side). */
const outputOf = ({ command, args }: { command: string; args: string[] }): string | undefined => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
};

type PullRefs = { base: string; head: string };

/** The PR's merge base and head commits, or undefined when the API cannot say. */
const pullRefsOf = ({ repo, pr }: { repo: string; pr: string }): PullRefs | undefined => {
  const [base, head] = (
    outputOf({
      command: "gh",
      args: ["api", `repos/${repo}/pulls/${pr}`, "--jq", '.base.sha + " " + .head.sha'],
    }) ?? ""
  )
    .trim()
    .split(" ");
  if (!base || !head) return undefined;
  // The files API diffs against the merge base, so the "before" side is read there too.
  const mergeBase = outputOf({
    command: "gh",
    args: ["api", `repos/${repo}/compare/${base}...${head}`, "--jq", ".merge_base_commit.sha"],
  })?.trim();
  return { base: mergeBase || base, head };
};

/**
 * Reads a file on each side of the PR: `git show` when ARCHITECTURE_BASE_REF and
 * ARCHITECTURE_HEAD_REF are set (a local run), else the GitHub contents API, since CI has a
 * sparse checkout with no history. An unreadable side is undefined; the caller fails closed.
 */
const contentReader = (): ContentReader => {
  const baseRef = process.env.ARCHITECTURE_BASE_REF;
  const headRef = process.env.ARCHITECTURE_HEAD_REF;
  if (baseRef && headRef) {
    return ({ path, side }) =>
      outputOf({
        command: "git",
        args: ["show", `${side === "base" ? baseRef : headRef}:${path}`],
      });
  }
  const repo = process.env.REPO;
  const pr = process.env.PR_NUMBER;
  let refs: PullRefs | undefined;
  const refsOf = (): PullRefs | undefined => {
    if (refs === undefined && repo && pr) refs = pullRefsOf({ repo, pr });
    return refs;
  };
  return ({ path, side }) => {
    const known = refsOf();
    if (known === undefined) return undefined;
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return outputOf({
      command: "gh",
      args: [
        "api",
        "-H",
        "Accept: application/vnd.github.raw",
        `repos/${repo}/contents/${encoded}?ref=${side === "base" ? known.base : known.head}`,
      ],
    });
  };
};

if (isEntrypoint()) {
  const path = process.argv[2];
  if (path === undefined) {
    throw new Error(
      "usage: guard-architecture-section.ts <changed-files.json>  (PR_AUTHOR, PR_BODY in env)",
    );
  }
  const files = parseChangedFileEntries(readFileSync(path, "utf8"));
  const { required, errors } = main({
    files,
    author: process.env.PR_AUTHOR ?? "",
    body: process.env.PR_BODY ?? "",
    read: contentReader(),
  });
  if (!required) {
    console.log("No '## Architecture' section required for these changes. OK.");
  } else if (errors.length === 0) {
    console.log("Architecture section present and filled in. OK.");
  } else {
    for (const error of errors) console.log(`::error::${error}`);
    process.exitCode = 1;
  }
}
