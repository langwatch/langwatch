import ts from "typescript";
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { walkFiles } from "./files.ts";
import type { ArchitectureViolation } from "./types.ts";

const POLICY = "enterprise-source-license";
const ENTERPRISE_ROOT = ["packages", "enterprise"];
const IGNORED_PATH_SEGMENTS = new Set(["dist", "fixtures", "generated", "node_modules", "tests"]);
const ENTERPRISE_DIRECTIVE = /^SPDX-License-Identifier:\s*LicenseRef-LangWatch-Enterprise\s*$/;

function relativeSegments(root: string, file: string): string[] {
  return relative(root, file).split(sep);
}

function isEnterpriseSource(file: string, root: string): boolean {
  const isImplementation = /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file);
  if (!isImplementation) return false;

  const segments = relativeSegments(root, file);
  const ignored = segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
  if (ignored) return false;

  if (segments.some((segment) => segment === "__tests__" || segment === "__fixtures__")) {
    return false;
  }

  if (/\.(?:test|spec)\.[cm]?tsx?$/.test(file)) return false;

  return true;
}

function enterpriseDirectiveLine(source: string, file: string): number | undefined {
  if (!source.includes("LicenseRef-LangWatch-Enterprise")) return void 0;

  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const comments = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    const ranges = [
      ...(ts.getLeadingCommentRanges(source, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.end) ?? []),
    ];
    for (const range of ranges) comments.set(range.pos, range);

    ts.forEachChild(node, visit);
  };
  visit(parsed);

  for (const comment of [...comments.values()].sort((left, right) => left.pos - right.pos)) {
    const lines = source.slice(comment.pos, comment.end).split(/\r?\n/);
    const index = lines.findIndex((line) => {
      const text = line
        .trim()
        .replace(/^(?:\/\/|\/\*+|\*)\s*/, "")
        .replace(/\s*\*\/$/, "");

      return ENTERPRISE_DIRECTIVE.test(text);
    });
    if (index >= 0) return parsed.getLineAndCharacterOfPosition(comment.pos).line + index + 1;
  }

  return void 0;
}

function isEnterprisePackageFile(root: string, file: string): boolean {
  const segments = relativeSegments(root, file);

  return segments[0] === ENTERPRISE_ROOT[0] && segments[1] === ENTERPRISE_ROOT[1];
}

/**
 * Enterprise licensing is a source-placement signal. It catches production
 * source that was marked proprietary before being moved into the Enterprise
 * aggregate; historical provenance without the marker remains unknowable.
 */
export function lintEnterpriseSourceLicense(root: string): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const sourceFiles = ["apps", "packages"].flatMap((directory) =>
    walkFiles(`${root}/${directory}`, (file) => isEnterpriseSource(file, root)),
  );

  for (const file of sourceFiles) {
    if (isEnterprisePackageFile(root, file)) continue;

    const line = enterpriseDirectiveLine(readFileSync(file, "utf8"), file);
    if (line === undefined) continue;

    violations.push({
      policy: POLICY,
      file,
      line,
      message:
        "Enterprise-licensed production source must move under the owning Enterprise feature; expose its portable contract through composition instead of removing the license header.",
      allowed:
        "Move the implementation under packages/enterprise and expose only its contract through the composed feature API.",
    });
  }

  return violations.sort((left, right) =>
    `${left.file}:${left.line ?? 0}`.localeCompare(`${right.file}:${right.line ?? 0}`),
  );
}
