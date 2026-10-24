import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";

import type { ArchitectureViolation } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  BEST_PRACTICES_DIRECTORY,
  type DeadCitation,
  deadCitationMessage,
  deadCitations,
  filesUnder,
  readKnown,
} from "./teaching-citations.ts";

/**
 * A reference page, product doc or spec citing a path not in the tree. Older debt than the
 * teaching pages, so tests/baselines/dead-path-citations.json holds the count per page,
 * shrink-only. Spec: specs/tooling/lint-teaching-citations.feature.
 */

export const DEAD_PATH_CITATIONS_POLICY = "dead-path-citations";

/**
 * Decision records, plans and dated reports are history: what they cite was true when they were
 * written. Best practices are teaching-citations' own, held at zero.
 */
const HISTORY_DIRECTORIES = [
  "dev/docs/adr",
  "dev/docs/plans",
  "dev/docs/reports",
  BEST_PRACTICES_DIRECTORY,
] as const;

const SURFACES = [
  { directory: "dev/docs", extensions: [".md", ".mdx"] },
  { directory: "docs", extensions: [".mdx"] },
  { directory: "specs", extensions: [".feature"] },
] as const;

const PATH_ONLY: ReadonlySet<DeadCitation["kind"]> = new Set(["path"]);

/**
 * Product docs speak to a customer about their own repository (`.claude/settings.json`,
 * `.github/workflows/...`) and to an MCP client in method names (`tools/list`); none of those is
 * a path in this tree.
 */
const CUSTOMER_ROOTS = [".claude/", ".github/", "tools/"] as const;

function citesThisTree({ root, citation }: { root: string; citation: DeadCitation }): boolean {
  if (!workspacePath({ root, file: citation.file }).startsWith("docs/")) return true;

  return !CUSTOMER_ROOTS.some((prefix) => citation.cited.startsWith(prefix));
}

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

/** Every page under dev/docs (except records, plans and best practices), docs and specs. */
export function referenceSurfaces(root: string): string[] {
  return SURFACES.flatMap(({ directory, extensions }) =>
    filesUnder({ directory: join(root, directory), extensions }),
  ).filter((file) => {
    const path = workspacePath({ root, file });

    return !HISTORY_DIRECTORIES.some((excluded) => path.startsWith(`${excluded}/`));
  });
}

/** The files git tracks; a sparse checkout (CI drops docs/images) still lists them. */
function trackedFiles(root: string): readonly string[] {
  try {
    const listed = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });

    return listed.split("\0").filter((path) => path.length > 0);
  } catch {
    return [];
  }
}

function isTracked({ tracked, cited }: { tracked: readonly string[]; cited: string }): boolean {
  const path = cited.replace(/\/+$/, "");

  return tracked.some((file) => file === path || file.startsWith(`${path}/`));
}

/** Every repository path a reference page cites that git does not track and the disk lacks. */
export function collectDeadPathCitations({ root }: { root: string }): DeadCitation[] {
  const tracked = trackedFiles(root);

  return deadCitations({
    root,
    files: referenceSurfaces(root),
    known: readKnown(root),
    kinds: PATH_ONLY,
  })
    .filter((citation) => citesThisTree({ root, citation }))
    .filter((citation) => !isTracked({ tracked, cited: citation.cited }));
}

/** The ratchet key: the page, repo-relative. */
export function deadPathCitationKey({
  root,
  citation,
}: {
  root: string;
  citation: DeadCitation;
}): string {
  return workspacePath({ root, file: citation.file });
}

export function lintDeadPathCitations(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;

  return collectDeadPathCitations({ root }).map((citation) => ({
    policy: DEAD_PATH_CITATIONS_POLICY,
    file: citation.file,
    line: citation.line,
    specifier: `${citation.kind}:${citation.cited}`,
    ...deadCitationMessage(citation),
  }));
}
