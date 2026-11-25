import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ArchitectureViolation } from "../../types.ts";
import { getAnchor } from "../../workspace/anchors.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * A teaching page citing a rule, policy, record section, skill or path that does not exist
 * teaches drift. Spec: specs/tooling/lint-teaching-citations.feature; plan step 6 of
 * dev/docs/plans/architecture-teaching-2026-10-05.md.
 */

export const TEACHING_CITATIONS_POLICY = "teaching-citations";
export const LINT_RULE_SKILL_POINTERS_POLICY = "lint-rule-skill-pointers";

export const RECORD = "dev/docs/ARCHITECTURE.md";
export const RULES_DIRECTORY = "packages/oxlint-rules/src/rules";
/** The registry this enforcer runs, not a copy in the scanned tree. */
export const POLICY_REGISTRY = fileURLToPath(new URL("../index.ts", import.meta.url));
export const ENFORCER_TESTS = "packages/architecture-enforcer/tests";
export const SKILLS_DIRECTORY = ".claude/skills";
const TEACHING_DIRECTORIES = [SKILLS_DIRECTORY, ".claude/rules"] as const;
const TEACHING_FILES = ["CLAUDE.md"] as const;

/** Skills the Claude Code harness ships; a page may route to one without it living in the tree. */
export const HARNESS_SKILLS: ReadonlySet<string> = new Set([
  "code-review",
  "simplify",
  "security-review",
  "init",
  "loop",
  "claude-api",
  "update-config",
]);

/** The top-level folders a backticked path must start with to be read as a repository path. */
const REPOSITORY_ROOTS: ReadonlySet<string> = new Set([
  "apps",
  "modules",
  "enterprise",
  "packages",
  "services",
  "sdks",
  "specs",
  "tools",
  "dev",
  "docs",
  "mcp",
  ".claude",
  ".github",
]);

type Known = {
  rules: ReadonlySet<string>;
  policies: ReadonlySet<string>;
  sections: ReadonlySet<string>;
  skills: ReadonlySet<string>;
  enforcerTests: readonly string[];
};

type Citation = {
  kind: "rule" | "backing" | "policy" | "section" | "skill" | "path" | "enforcer-test";
  cited: string;
  line: number;
};

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

function markdownUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();
}

/** CLAUDE.md and every Markdown page under .claude/skills and .claude/rules. */
export function citingSurfaces(root: string): string[] {
  const files = TEACHING_FILES.map((file) => join(root, file)).filter((file) => existsSync(file));

  for (const directory of TEACHING_DIRECTORIES) files.push(...markdownUnder(join(root, directory)));

  return files;
}

/** Each `name: "<id>"` declared by a rule file, keyed by rule id, with the file's text. */
export function readLintRules(root: string): Map<string, { file: string; source: string }> {
  const directory = getAnchor({ root, anchor: RULES_DIRECTORY, policy: TEACHING_CITATIONS_POLICY });
  const rules = new Map<string, { file: string; source: string }>();

  for (const name of readdirSync(directory)
    .filter((entry) => entry.endsWith(".mjs"))
    .toSorted()) {
    const file = join(directory, name);
    const source = readFileSync(file, "utf8");
    const id = /^\s*name:\s*"([a-z0-9-]+)"/m.exec(source)?.[1];
    if (id !== undefined) rules.set(id, { file, source });
  }

  return rules;
}

function readPolicyIds(): Set<string> {
  const file = POLICY_REGISTRY;

  return new Set(
    [...readFileSync(file, "utf8").matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]!),
  );
}

/** `## 15. Title` and `### 3.1 Title` give `15` and `3.1`. */
function readSections(root: string): Set<string> {
  const file = getAnchor({ root, anchor: RECORD, policy: TEACHING_CITATIONS_POLICY });
  const headings = readFileSync(file, "utf8").matchAll(/^#{2,4}\s+(\d+(?:\.\d+)*)\.?\s/gm);

  return new Set([...headings].map((match) => match[1]!));
}

export function readSkills(root: string): Set<string> {
  const directory = join(root, SKILLS_DIRECTORY);
  const skills = new Set(HARNESS_SKILLS);

  for (const file of markdownUnder(directory).filter((path) => path.endsWith(`${sep}SKILL.md`))) {
    skills.add(workspacePath({ root: directory, file }).split("/").at(-2)!);
    const declared = /^name:\s*["']?([\w:-]+)/m.exec(readFileSync(file, "utf8"))?.[1];
    if (declared !== undefined) skills.add(declared);
  }

  return skills;
}

function readEnforcerTests(root: string): string[] {
  const directory = join(root, ENFORCER_TESTS);

  return existsSync(directory) ? readdirSync(directory) : [];
}

const PLACEHOLDER = /[<>*{}[\]…]|\.\.\./;

function segmentPattern(segment: string): RegExp {
  const escaped = segment
    .replace(/<[^>]*>/g, "\uE000")
    .replace(/[.+?^$()|\\]/g, "\\$&")
    .replace(/\{([^}]*)\}/g, (_, options: string) => `(?:${options.split(",").join("|")})`)
    .replace(/\*/g, "[^/]*")
    .replace(/\uE000/g, "[^/]+");

  return new RegExp(`^${escaped}$`);
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

/**
 * True when some file or folder matches the path: `<placeholder>`, `*` and `{a,b}` match any
 * name, and `**` stops the walk.
 */
export function pathExists({ root, path }: { root: string; path: string }): boolean {
  let candidates = [root];

  for (const segment of path.split("/").filter((part) => part !== "")) {
    if (segment === "**" || segment.includes("...") || segment.includes("…"))
      return candidates.length > 0;
    if (!PLACEHOLDER.test(segment)) {
      candidates = candidates.map((at) => join(at, segment)).filter((at) => existsSync(at));
    } else {
      const pattern = segmentPattern(segment);
      candidates = candidates.filter(isDirectory).flatMap((at) =>
        readdirSync(at)
          .filter((name) => pattern.test(name))
          .map((name) => join(at, name)),
      );
    }
    if (candidates.length === 0) return false;
  }

  return true;
}

/** A backticked span read as a repository path, its line suffix and anchor dropped. */
export function repositoryPathOf(span: string): string | undefined {
  if (/[\s=@$|;'"(),]/.test(span) || !span.includes("/")) return undefined;
  const path = span.replace(/#.*$/, "").replace(/:\d+(?:[-,]\d+)*$/, "");
  const [first, ...rest] = path.split("/");
  if (rest.some((segment) => segment.startsWith("."))) return undefined;

  if (!REPOSITORY_ROOTS.has(first!)) return undefined;

  return path;
}

type Table = { backedBy: number; skill: number };

function headerOf(line: string): Table {
  const cells = cellsOf(line);

  return {
    backedBy: cells.findIndex((cell) => /backed by/i.test(cell)),
    skill: cells.findIndex((cell) => /\bskills?\b/i.test(cell) && !/backed by/i.test(cell)),
  };
}

function cellsOf(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
}

/**
 * A "Backed by" cell is `;`-separated groups: `policy`/`policies` and `enforcer tests` name
 * their kind; a bare list of spans names rules (or a skill); prose groups are not citations.
 */
function backedByKind(lead: string): Citation["kind"] {
  if (/^polic(?:y|ies)\b/i.test(lead)) return "policy";
  if (/^enforcer tests?\b/i.test(lead)) return "enforcer-test";

  return "backing";
}

function backedByCitations({ cell, line }: { cell: string; line: number }): Citation[] {
  return cell.split(";").flatMap((group) => {
    const lead = group.trim();
    if (/^(?:boot|runtime|a human gate)\b/i.test(lead)) return [];
    const kind = backedByKind(lead);
    const withoutAsides = lead.replace(/\([^)]*\)/g, "");
    const prose = withoutAsides
      .replace(/`[^`]*`/g, "")
      .replace(/^polic(?:y|ies)|^enforcer tests?/i, "");
    if (kind === "backing" && !/^[\s,]*$/.test(prose.replace(/\band\b/g, ""))) return [];

    return codeSpans(withoutAsides)
      .filter((span) => span !== "unbacked")
      .map((span) =>
        span.startsWith("langwatch/")
          ? { kind: "rule" as const, cited: span.slice(10) }
          : { kind, cited: span },
      )
      .filter(({ cited }) => KEBAB.test(cited))
      .map((citation) => ({ ...citation, line }));
  });
}

/** Another document's section (`ADR-150 §2`, `LANE.md §8`) is not the record's. */
const FOREIGN_SECTION = /(?:ADR-\d+|[\w-]+\.md|LANE|COORDINATOR|section)\s*,?\s*$/i;

function inlineCitations({ text, line }: { text: string; line: number }): Citation[] {
  const found: Citation[] = [];

  for (const match of text.matchAll(/(?<![@\w/.-])langwatch\/([a-z][a-z0-9-]*)/g)) {
    if (match[1] !== "langwatch") found.push({ kind: "rule", cited: match[1]!, line });
  }
  for (const match of text.matchAll(/§(\d+(?:\.\d+)*)/g)) {
    if (!FOREIGN_SECTION.test(text.slice(0, match.index))) {
      found.push({ kind: "section", cited: match[1]!, line });
    }
  }
  for (const match of text.matchAll(/`([a-z][a-z0-9:-]*)` skill\b/g)) {
    found.push({ kind: "skill", cited: match[1]!, line });
  }
  for (const span of codeSpans(text)) {
    const path = repositoryPathOf(span);
    if (path !== undefined) found.push({ kind: "path", cited: path, line });
  }

  return found;
}

/** A citation its paragraph retires ("deleted", "the former") is history, not teaching. */
const RETIRED = /\b(?:deleted|gone|former(?:ly)?|removed|retired|no longer|not in the tree)\b/i;
/** "Never" retires only what its own line names; the rest of the paragraph still teaches. */
const FORBIDDEN = /\bnever\b/i;

/** A table row is its own context; prose is read by paragraph, since a sentence wraps lines. */
function contextOf({ lines, index }: { lines: readonly string[]; index: number }): string {
  if (lines[index]!.trim().startsWith("|")) return lines[index]!;
  const blank = (at: number) => (lines[at] ?? "").trim() === "";
  let start = index;
  let end = index;
  while (start > 0 && !blank(start - 1)) start -= 1;
  while (end < lines.length - 1 && !blank(end + 1)) end += 1;

  return lines.slice(start, end + 1).join("\n");
}

const SEPARATOR = /^\s*\|[\s:|-]+\|\s*$/;

function rowCitations({
  table,
  text,
  line,
}: {
  table: Table;
  text: string;
  line: number;
}): Citation[] {
  const cells = cellsOf(text);
  const backedBy = table.backedBy >= 0 ? cells[table.backedBy] : undefined;
  const skill = table.skill >= 0 ? cells[table.skill] : undefined;
  const skills = codeSpans(skill ?? "").filter((span) => KEBAB.test(span));

  return [
    ...(backedBy === undefined ? [] : backedByCitations({ cell: backedBy, line })),
    ...skills.map((cited) => ({ kind: "skill" as const, cited, line })),
  ];
}

/** Every citation one Markdown page makes, fenced code and retired mentions skipped. */
export function citationsIn(source: string): Citation[] {
  const lines = source.split("\n");
  const found: Citation[] = [];
  let fenced = false;
  let table: Table | undefined;

  lines.forEach((text, index) => {
    const line = index + 1;
    if (/^\s*(?:```|~~~)/.test(text)) fenced = !fenced;
    if (fenced || /^\s*(?:```|~~~)/.test(text)) return;

    if (!text.trim().startsWith("|")) table = undefined;
    else if (SEPARATOR.test(lines[index + 1] ?? "")) table = headerOf(text);
    else if (table !== undefined && !SEPARATOR.test(text)) {
      found.push(...rowCitations({ table, text, line }));
    }

    found.push(...inlineCitations({ text, line }));
  });

  return found.filter(
    ({ line }) =>
      !RETIRED.test(contextOf({ lines, index: line - 1 })) && !FORBIDDEN.test(lines[line - 1]!),
  );
}

const WHERE: Record<Citation["kind"], string> = {
  rule: `a \`name:\` in ${RULES_DIRECTORY}`,
  backing: `a \`name:\` in ${RULES_DIRECTORY} or a skill folder under ${SKILLS_DIRECTORY}`,
  policy: `an \`id:\` in ${POLICY_REGISTRY} (\`pnpm lint:architecture --list-policies\`)`,
  section: `a numbered heading in ${RECORD}`,
  skill: `a skill folder under ${SKILLS_DIRECTORY}`,
  path: "a file or folder in the repository",
  "enforcer-test": `a test file in ${ENFORCER_TESTS}`,
};

const NOUN: Record<Citation["kind"], string> = {
  rule: "lint rule `langwatch/",
  backing: "lint rule `langwatch/",
  policy: "enforcer policy `",
  section: "record section `§",
  skill: "skill `",
  path: "path `",
  "enforcer-test": "enforcer test `",
};

function exists({
  citation,
  known,
  root,
}: {
  citation: Citation;
  known: Known;
  root: string;
}): boolean {
  switch (citation.kind) {
    case "rule":
      return known.rules.has(citation.cited);
    case "backing":
      return known.rules.has(citation.cited) || known.skills.has(citation.cited);
    case "policy":
      return known.policies.has(citation.cited);
    case "section":
      return known.sections.has(citation.cited);
    case "skill":
      return known.skills.has(citation.cited);
    case "enforcer-test":
      return known.enforcerTests.some((file) => file.startsWith(`${citation.cited}.`));
    case "path":
      return (
        isModuleRelative({ root, path: citation.cited }) ||
        pathExists({ root, path: citation.cited })
      );
  }
}

/** `services/<x>.service.ts` is module-relative; only `services/<service>` is top-level. */
function isModuleRelative({ root, path }: { root: string; path: string }): boolean {
  const [first, second] = path.split("/");

  return (
    first === "services" && (second === undefined || !isDirectory(join(root, "services", second)))
  );
}

/** Every rule, policy, section, skill and path a teaching page cites that does not exist. */
export function lintTeachingCitations(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const known: Known = {
    rules: new Set(readLintRules(root).keys()),
    policies: readPolicyIds(),
    sections: readSections(root),
    skills: readSkills(root),
    enforcerTests: readEnforcerTests(root),
  };
  const violations: ArchitectureViolation[] = [];

  for (const file of citingSurfaces(root)) {
    for (const citation of citationsIn(readFileSync(file, "utf8"))) {
      if (exists({ citation, known, root })) continue;
      violations.push({
        policy: TEACHING_CITATIONS_POLICY,
        file,
        line: citation.line,
        specifier: `${citation.kind}:${citation.cited}`,
        message: `This page cites ${NOUN[citation.kind]}${citation.cited}\`, which is not ${WHERE[citation.kind]}; an agent following it will look for something that is gone.`,
        allowed:
          "Cite what exists today: the renamed rule, policy, section, skill or path, or drop the citation. A `<placeholder>` or `*` segment matches any name.",
      });
    }
  }

  return violations;
}

/** Comments say why a rule exists; only its messages and docs reach the agent that trips it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** True when the text names an existing skill: `<skill> skill` or `.claude/skills/<skill>`. */
export function namesASkill({
  text,
  skills,
}: {
  text: string;
  skills: ReadonlySet<string>;
}): boolean {
  const named = [
    ...text.matchAll(/`?([a-z][a-z0-9-]*)`? skill\b/g),
    ...text.matchAll(/\.claude\/skills\/([a-z][a-z0-9-]*)/g),
  ];

  return named.some((match) => skills.has(match[1]!));
}

/** Every house rule whose messages name no skill to read. Report-only: not in the CI gate. */
export function lintLintRuleSkillPointers(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const skills = readSkills(root);
  const violations: ArchitectureViolation[] = [];

  for (const [id, { file, source }] of readLintRules(root)) {
    if (namesASkill({ text: withoutComments(source), skills })) continue;
    violations.push({
      policy: LINT_RULE_SKILL_POINTERS_POLICY,
      file,
      specifier: `langwatch/${id}`,
      message: `\`langwatch/${id}\` names no skill, so an agent that trips it has nowhere to learn the shape it wants.`,
      allowed:
        "Name the skill that teaches the fix in the rule's message (`... see the `<skill>` skill`).",
    });
  }

  return violations;
}
