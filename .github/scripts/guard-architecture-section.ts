// Decides whether a pull request must carry a `## Architecture` section, and
// whether its description fills it in. Exempt: docs-only changes, lockfiles,
// and a dependency bot's manifest bumps (file kinds come from
// guard-deployment-impact.ts). Dependency-free plain functions.
// Spec: specs/ci/pr-architecture-section.feature

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isDependencyBot, kindOf, parseChangedFiles } from "./guard-deployment-impact.ts";

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
const TICKED = /^[ \t]*[-*][ \t]+\[x\]/i;
const UNTICKED = /^[ \t]*[-*][ \t]+\[ \]/;

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

  const architecture = lines.findIndex((line) => ARCHITECTURE_HEADING.test(line));
  if (architecture === -1) {
    errors.push(
      "No '## Architecture' heading in the PR description. Add it as a top-level H2 (the PR template has it): tick the box after reading the sections of dev/docs/ARCHITECTURE.md this change touches, and add a 'Needs a human look' part.",
    );
  } else {
    const section = sectionAfter({ lines, start: architecture, level: 2 });
    if (!section.some((line) => TICKED.test(line))) {
      errors.push(
        "The conformance checkbox under '## Architecture' is not ticked. Read the sections of dev/docs/ARCHITECTURE.md this change touches, check that it follows them, then tick '- [x]'.",
      );
    } else if (section.some((line) => UNTICKED.test(line))) {
      errors.push(
        "A checkbox under '## Architecture' is still unticked. Tick it once it is true, or remove it.",
      );
    }
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

export const main = ({
  files,
  author,
  body,
}: {
  files: readonly string[];
  author: string;
  body: string;
}): { required: boolean; errors: string[] } => {
  const required = requiresSection({ files, author });
  return { required, errors: required ? checkBody(body) : [] };
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  const path = process.argv[2];
  if (path === undefined) {
    throw new Error(
      "usage: guard-architecture-section.ts <changed-files.json>  (PR_AUTHOR, PR_BODY in env)",
    );
  }
  const files = parseChangedFiles(readFileSync(path, "utf8"));
  const { required, errors } = main({
    files,
    author: process.env.PR_AUTHOR ?? "",
    body: process.env.PR_BODY ?? "",
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
